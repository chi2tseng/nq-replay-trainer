"""Fetch REAL CME tick (trades) from Databento -> one compact JSON per ET trading day,
for the app's Tradovate-style per-day tick replay. Streams the CSV so memory stays bounded.
Key from env DB_KEY (never committed). Output: data/tick/<SYM>_<YYYY-MM-DD>.json

Usage: python fetch_tick_days.py <start> <end> [symbol] [tick]
  one day : python fetch_tick_days.py 2026-06-24 2026-06-25
  3 months: python fetch_tick_days.py 2026-03-26 2026-06-26 NQ.v.0 0.25

Per-day file (columnar, ms-resolution):
  {"day","sym","tick","t0":<epoch_ms of first tick>,
   "dt":[ms offset from t0...], "p":[price...], "s":[size...]}
"""
import sys, os, json, csv, io, base64, urllib.request, urllib.parse, datetime

KEY = os.environ["DB_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "..", "data", "tick")
os.makedirs(OUT, exist_ok=True)
start, end = sys.argv[1], sys.argv[2]
SYM = sys.argv[3] if len(sys.argv) > 3 else "NQ.v.0"
TICK = float(sys.argv[4]) if len(sys.argv) > 4 else 0.25
SYMBOL = SYM.split(".")[0]
rt = lambda x: round(round(x / TICK) * TICK, 2)

# futures trading day rolls at 18:00 ET -> shift +6h, take ET date (DST-correct via zoneinfo, else EDT fallback)
try:
    from zoneinfo import ZoneInfo; ET = ZoneInfo("America/New_York")
    def trading_day(ts): return (datetime.datetime.fromtimestamp(ts, ET) + datetime.timedelta(hours=6)).strftime("%Y-%m-%d")
except Exception:
    def trading_day(ts): return (datetime.datetime.utcfromtimestamp(ts) + datetime.timedelta(hours=2)).strftime("%Y-%m-%d")

def ep_ms(s):
    if s.isdigit(): return int(s) // 1_000_000                       # raw nanoseconds
    base = datetime.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc)
    ms = int(base.timestamp()) * 1000
    if len(s) > 20 and s[19] == ".": ms += int(s[20:].rstrip("Z")[:3].ljust(3, "0"))
    return ms

cur = {"day": None, "t0": None, "dt": [], "p": [], "s": []}
written = []
def flush():
    if cur["day"] is None or not cur["p"]: return
    path = os.path.join(OUT, f"{SYMBOL}_{cur['day']}.json")
    json.dump({"day": cur["day"], "sym": SYMBOL, "tick": TICK, "t0": cur["t0"], "dt": cur["dt"], "p": cur["p"], "s": cur["s"]}, open(path, "w"))
    written.append((cur["day"], len(cur["p"]), os.path.getsize(path)))

def weeks(s, e):
    sd = datetime.date.fromisoformat(s); ed = datetime.date.fromisoformat(e); d = sd
    while d < ed:
        n = min(d + datetime.timedelta(days=7), ed); yield d.isoformat(), n.isoformat(); d = n

for ws, we in weeks(start, end):
    params = {"dataset": "GLBX.MDP3", "symbols": SYM, "schema": "trades", "stype_in": "continuous",
              "start": ws, "end": we, "encoding": "csv", "pretty_px": "true", "pretty_ts": "true"}
    url = "https://hist.databento.com/v0/timeseries.get_range?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url); req.add_header("Authorization", "Basic " + base64.b64encode((KEY + ":").encode()).decode())
    resp = urllib.request.urlopen(req, timeout=1800)
    for r in csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8")):
        p = r.get("price");
        if not p: continue
        ms = ep_ms(r["ts_event"]); day = trading_day(ms // 1000)
        if day != cur["day"]: flush(); cur = {"day": day, "t0": ms, "dt": [], "p": [], "s": []}
        cur["dt"].append(ms - cur["t0"]); cur["p"].append(rt(float(p))); cur["s"].append(int(r.get("size") or 0))
flush()
import glob
days = sorted(os.path.basename(f)[len(SYMBOL) + 1:-5] for f in glob.glob(os.path.join(OUT, f"{SYMBOL}_*.json")))
json.dump(days, open(os.path.join(OUT, "index.json"), "w"))
for d, n, sz in written: print(f"  {d}: {n:,} ticks  {sz/1e6:.1f} MB")
print(f"{len(written)} day-file(s) -> {OUT}  (index.json now lists {len(days)} day(s))")
