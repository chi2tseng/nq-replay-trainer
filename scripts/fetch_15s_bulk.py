"""Bulk 15-second OHLCV history from Databento, in WEEKLY chunks (retry-safe, resumable).

Fetches ohlcv-1s (Databento's finest native OHLCV schema — there is no native 15s schema)
and aggregates each chunk straight to 15s bars on the fly, so raw 1s rows are never written
to disk. Each week is its own HTTP call so a dropped connection only costs a retry of that
week, and a completed week is never re-fetched (never charged twice for what's on disk) —
same pattern as fetch_tick_days.py's day-chunking, just weekly since OHLCV rows are far
lighter than raw trades.

Key from env DB_KEY (never committed). Output: data/<SYM>_15s_bulk.json (one growing file).

Usage: python fetch_15s_bulk.py <start> <end> <SYM> <out.json> [tick]
  python fetch_15s_bulk.py 2023-08-12 2026-08-12 NQ.v.0 NQ_db_15s.json 0.25
"""
import sys, os, json, csv, io, base64, urllib.request, urllib.parse, datetime, time

KEY = os.environ["DB_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
start, end, SYM, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
TICK = float(sys.argv[5]) if len(sys.argv) > 5 else 0.25
AGG = 15
rt = lambda x: round(round(x / TICK) * TICK, 2)

def weeks(s, e):
    sd = datetime.date.fromisoformat(s); ed = datetime.date.fromisoformat(e); d = sd
    while d < ed:
        n = min(d + datetime.timedelta(days=7), ed); yield d.isoformat(), n.isoformat(); d = n

def fetch_chunk(ws, we):
    params = {"dataset": "GLBX.MDP3", "symbols": SYM, "schema": "ohlcv-1s", "stype_in": "continuous",
              "start": ws, "end": we, "encoding": "csv", "pretty_px": "true", "pretty_ts": "true"}
    url = "https://hist.databento.com/v0/timeseries.get_range?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url); req.add_header("Authorization", "Basic " + base64.b64encode((KEY + ":").encode()).decode())
    resp = urllib.request.urlopen(req, timeout=300)
    agg = {}
    for r in csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8")):
        o = r.get("open")
        if not o: continue
        t = int(datetime.datetime.strptime(r["ts_event"][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp())
        b = (t // AGG) * AGG
        oo, h, l, c, v = float(o), float(r["high"]), float(r["low"]), float(r["close"]), int(r["volume"] or 0)
        x = agg.get(b)
        if x is None: agg[b] = [oo, h, l, c, v]
        else: x[1] = max(x[1], h); x[2] = min(x[2], l); x[3] = c; x[4] += v
    return agg

path = os.path.join(DATA, OUT)
done_path = path + ".weeks"                                          # manifest of completed week-starts, for resume
existing = {b["time"]: b for b in json.load(open(path))} if os.path.exists(path) else {}
done = set(open(done_path).read().split()) if os.path.exists(done_path) else set()

chunks = list(weeks(start, end)); failed = []
print(f"fetching {SYM} ohlcv-1s -> 15s  {start}..{end}  in {len(chunks)} weekly chunks  ({len(done)} already done)", flush=True)
for ci, (ws, we) in enumerate(chunks):
    if ws in done:
        continue
    agg = None
    for attempt in range(4):
        try: agg = fetch_chunk(ws, we); break
        except Exception as ex:
            sys.stderr.write(f"[{ws}..{we}] attempt {attempt + 1}/4 failed: {ex}\n"); time.sleep(5)
    if agg is None:
        failed.append((ws, we)); print(f"  chunk {ci + 1}/{len(chunks)} {ws}..{we}  FAILED", flush=True); continue
    for b, x in agg.items():
        existing[b] = {"time": b, "open": rt(x[0]), "high": rt(x[1]), "low": rt(x[2]), "close": rt(x[3]), "volume": x[4]}
    json.dump([existing[t] for t in sorted(existing)], open(path, "w"))
    with open(done_path, "a") as f: f.write(ws + "\n")
    print(f"  chunk {ci + 1}/{len(chunks)} {ws}..{we}  +{len(agg)} bars  (total {len(existing)})", flush=True)

print(f"DONE: {len(existing)} bars -> {OUT}", flush=True)
if failed:
    print("RE-RUN this same command to retry failed weeks (already-done weeks are skipped, not re-charged):", failed, flush=True)
