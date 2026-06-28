"""Fetch REAL CME tick (trades) from Databento -> one compact JSON per ET trading day,
for the app's Tradovate-style per-day tick replay.

Robust: fetches in weekly chunks, each accumulated IN MEMORY and retried up to 4x, so a
dropped connection re-runs that week cleanly (no partial/corrupt files, no wasted spend).
Trading days that straddle a chunk boundary are append-merged. Key from env DB_KEY (never committed).
Output: data/tick/<SYM>_<YYYY-MM-DD>.json  +  data/tick/index.json (manifest the app reads)

Usage: python fetch_tick_days.py <start> <end> [symbol] [tick]
  one day : python fetch_tick_days.py 2026-06-24 2026-06-25
  3 months: python fetch_tick_days.py 2026-03-27 2026-06-27 NQ.v.0 0.25

Per-day file (columnar, ms-resolution):
  {"day","sym","tick","t0":<epoch_ms first tick>, "dt":[ms offset from t0...], "p":[price...], "s":[size...]}
"""
import sys, os, json, csv, io, base64, urllib.request, urllib.parse, datetime, time, glob

KEY = os.environ["DB_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "..", "data", "tick")
os.makedirs(OUT, exist_ok=True)
start, end = sys.argv[1], sys.argv[2]
SYM = sys.argv[3] if len(sys.argv) > 3 else "NQ.v.0"
TICK = float(sys.argv[4]) if len(sys.argv) > 4 else 0.25
SYMBOL = SYM.split(".")[0]
rt = lambda x: round(round(x / TICK) * TICK, 2)

# futures trading day rolls at 18:00 ET -> shift +6h, take ET date (DST-correct via zoneinfo)
try:
    from zoneinfo import ZoneInfo; ET = ZoneInfo("America/New_York")
    def trading_day(ts): return (datetime.datetime.fromtimestamp(ts, ET) + datetime.timedelta(hours=6)).strftime("%Y-%m-%d")
except Exception:
    def trading_day(ts): return (datetime.datetime.utcfromtimestamp(ts) + datetime.timedelta(hours=2)).strftime("%Y-%m-%d")

def ep_ms(s):
    if s.isdigit(): return int(s) // 1_000_000
    b = datetime.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    ms = int(b.timestamp()) * 1000
    if len(s) > 20 and s[19] == ".": ms += int(s[20:].rstrip("Z")[:3].ljust(3, "0"))
    return ms

def weeks(s, e):
    sd = datetime.date.fromisoformat(s); ed = datetime.date.fromisoformat(e); d = sd
    while d < ed:
        n = min(d + datetime.timedelta(days=7), ed); yield d.isoformat(), n.isoformat(); d = n

def fetch_chunk(ws, we):
    params = {"dataset": "GLBX.MDP3", "symbols": SYM, "schema": "trades", "stype_in": "continuous",
              "start": ws, "end": we, "encoding": "csv", "pretty_px": "true", "pretty_ts": "true"}
    url = "https://hist.databento.com/v0/timeseries.get_range?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url); req.add_header("Authorization", "Basic " + base64.b64encode((KEY + ":").encode()).decode())
    resp = urllib.request.urlopen(req, timeout=3600)
    days = {}
    for r in csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8")):
        p = r.get("price")
        if not p: continue
        ms = ep_ms(r["ts_event"]); day = trading_day(ms // 1000)
        d = days.get(day)
        if d is None: d = days[day] = {"t0": ms, "dt": [], "p": [], "s": []}
        d["dt"].append(ms - d["t0"]); d["p"].append(rt(float(p))); d["s"].append(int(r.get("size") or 0))
    return days

def write_day(day, d):
    path = os.path.join(OUT, f"{SYMBOL}_{day}.json")
    if os.path.exists(path):                                   # straddles a chunk boundary -> append (rebase dt to existing t0)
        old = json.load(open(path)); base = old["t0"]
        old["dt"] += [d["t0"] + off - base for off in d["dt"]]; old["p"] += d["p"]; old["s"] += d["s"]
        json.dump(old, open(path, "w")); return len(old["p"])
    json.dump({"day": day, "sym": SYMBOL, "tick": TICK, "t0": d["t0"], "dt": d["dt"], "p": d["p"], "s": d["s"]}, open(path, "w"))
    return len(d["p"])

chunks = list(weeks(start, end)); failed = []
print(f"fetching {SYMBOL} trades {start}..{end} in {len(chunks)} weekly chunks", flush=True)
for ci, (ws, we) in enumerate(chunks):
    days = None
    for attempt in range(4):
        try: days = fetch_chunk(ws, we); break
        except Exception as ex:
            sys.stderr.write(f"[{ws}..{we}] attempt {attempt + 1}/4 failed: {ex}\n"); time.sleep(5)
    if days is None: failed.append((ws, we)); print(f"  chunk {ci + 1}/{len(chunks)} {ws}..{we}  FAILED", flush=True); continue
    tot = sum(write_day(day, days[day]) for day in sorted(days))
    print(f"  chunk {ci + 1}/{len(chunks)} {ws}..{we}  {len(days)} days  {tot:,} ticks", flush=True)

alldays = sorted(os.path.basename(f)[len(SYMBOL) + 1:-5] for f in glob.glob(os.path.join(OUT, f"{SYMBOL}_*.json")))
json.dump(alldays, open(os.path.join(OUT, "index.json"), "w"))
print(f"DONE: {len(alldays)} day-files, index.json updated -> {OUT}")
if failed: print("RE-RUN these week ranges (not charged twice for what's already on disk):", failed)
