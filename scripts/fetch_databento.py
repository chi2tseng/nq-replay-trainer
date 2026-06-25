"""Fetch REAL CME futures from Databento (GLBX.MDP3) -> data/<out>.json (app format).
Key read from env DB_KEY (never hard-code / commit it).
Usage: python fetch_databento.py <schema> <start> <end> <out.json> [tick] [agg_seconds] [symbol]
  schema: ohlcv-1m | ohlcv-1s | trades | ...
  agg_seconds: if >0, aggregate the fetched bars/ticks into N-second OHLCV bars
Examples:
  deep 1-min:  python fetch_databento.py ohlcv-1m 2025-06-24 2026-06-24 NQ_db_1m.json 0.25
  15-second:   python fetch_databento.py ohlcv-1s 2026-04-24 2026-06-24 NQ_db_15s.json 0.25 15
"""
import sys, os, json, csv, io, base64, urllib.request, urllib.parse, datetime

KEY = os.environ["DB_KEY"]
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
schema, start, end, out = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
TICK = float(sys.argv[5]) if len(sys.argv) > 5 else 0.25
AGG = int(sys.argv[6]) if len(sys.argv) > 6 else 0
SYM = sys.argv[7] if len(sys.argv) > 7 else "NQ.v.0"

params = {"dataset": "GLBX.MDP3", "symbols": SYM, "schema": schema, "stype_in": "continuous",
          "start": start, "end": end, "encoding": "csv", "pretty_px": "true", "pretty_ts": "true"}
url = "https://hist.databento.com/v0/timeseries.get_range?" + urllib.parse.urlencode(params)
req = urllib.request.Request(url)
req.add_header("Authorization", "Basic " + base64.b64encode((KEY + ":").encode()).decode())
resp = urllib.request.urlopen(req, timeout=900)

rt = lambda x: round(round(x / TICK) * TICK, 2)
def ep(s):  # "2026-06-21T22:00:00.000000000Z" -> epoch seconds (UTC)
    return int(datetime.datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=datetime.timezone.utc).timestamp())

rows = csv.DictReader(io.TextIOWrapper(resp, encoding="utf-8"))
src = 0
if AGG:                      # aggregate (ohlcv-1s or trades) -> N-second OHLCV
    agg = {}
    is_trades = schema == "trades"
    for r in rows:
        src += 1
        t = ep(r["ts_event"]); b = (t // AGG) * AGG
        if is_trades:
            p = float(r["price"]); v = int(r.get("size") or 0)
            x = agg.get(b)
            if x is None: agg[b] = [p, p, p, p, v]
            else: x[1] = max(x[1], p); x[2] = min(x[2], p); x[3] = p; x[4] += v
        else:
            o = r.get("open");
            if not o: continue
            o = float(o); h = float(r["high"]); l = float(r["low"]); c = float(r["close"]); v = int(r["volume"] or 0)
            x = agg.get(b)
            if x is None: agg[b] = [o, h, l, c, v]
            else: x[1] = max(x[1], h); x[2] = min(x[2], l); x[3] = c; x[4] += v
    bars = [{"time": b, "open": rt(x[0]), "high": rt(x[1]), "low": rt(x[2]), "close": rt(x[3]), "volume": x[4]} for b, x in sorted(agg.items())]
else:                        # native OHLCV bars, no aggregation
    bars = []
    for r in rows:
        src += 1
        o = r.get("open")
        if not o: continue
        bars.append({"time": ep(r["ts_event"]), "open": rt(float(o)), "high": rt(float(r["high"])),
                     "low": rt(float(r["low"])), "close": rt(float(r["close"])), "volume": int(r["volume"] or 0)})

json.dump(bars, open(os.path.join(DATA, out), "w"))
n = len(bars)
if n:
    f0 = datetime.datetime.utcfromtimestamp(bars[0]["time"]); f1 = datetime.datetime.utcfromtimestamp(bars[-1]["time"])
    lo = min(b["low"] for b in bars); hi = max(b["high"] for b in bars)
    flat = sum(1 for b in bars if b["open"] == b["high"] == b["low"] == b["close"])
    print(f"{out}: {n} bars (src {src})  {f0}..{f1} UTC  px {lo}..{hi}  flat={flat}")
else:
    print(f"{out}: 0 bars (src {src})")
