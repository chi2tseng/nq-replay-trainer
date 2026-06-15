"""Convert a Dukascopy 'USA 100' (Nasdaq-100 CFD) m1 JSON export -> data/NQ_deep_1m.json.
Free deep history that tracks NQ within a small basis. dukascopy-node JSON rows:
  {timestamp(ms), open, high, low, close, volume}. Prices are the INDEX (decimals), so we
snap to the 0.25 NQ tick grid to keep the simulator's tick math consistent.
"""
import json, os, glob, datetime
try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
    def is_weekend(t): return datetime.datetime.fromtimestamp(t + 6 * 3600, _ET).weekday() >= 5
except Exception:                                  # no IANA tzdata -> UTC approximation
    def is_weekend(t):
        d = datetime.datetime.utcfromtimestamp(t); wd = d.weekday()
        return wd == 5 or (wd == 4 and d.hour >= 22) or (wd == 6 and d.hour < 22)

HERE = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(HERE, "..", "data")
cands = sorted(glob.glob(os.path.join(d, "duka", "usatechidxusd-m1-*.json")))
if not cands:
    raise SystemExit("no dukascopy file in data/duka — run the dukascopy-node fetch first")
src = max(cands, key=os.path.getsize)    # widest range = most data
rows = json.load(open(src))
TICK = 0.25
def rt(x): return round(round(x / TICK) * TICK, 2)

by_t = {}
for r in rows:
    if r.get("open") is None:
        continue
    t = int(r["timestamp"] // 1000)      # ms -> s (UTC)
    if is_weekend(t):
        continue                          # drop weekend close (futures shut Fri 17:00 ET -> Sun 18:00 ET)
    by_t[t] = {"time": t, "open": rt(r["open"]), "high": rt(r["high"]),
               "low": rt(r["low"]), "close": rt(r["close"]),
               "volume": int(round((r.get("volume") or 0) * 1000))}  # duka vol is relative, scaled for display only
bars = [by_t[t] for t in sorted(by_t)]

out = os.path.join(d, "NQ_deep_1m.json")
with open(out, "w") as f:
    json.dump(bars, f)
print(f"wrote {len(bars)} 1-min bars -> {os.path.normpath(out)}  (src {os.path.basename(src)})")
if bars:
    f0 = datetime.datetime.utcfromtimestamp(bars[0]["time"])
    f1 = datetime.datetime.utcfromtimestamp(bars[-1]["time"])
    lo = min(b["low"] for b in bars); hi = max(b["high"] for b in bars)
    print(f"  range {f0} .. {f1} UTC   price {lo} .. {hi}")
