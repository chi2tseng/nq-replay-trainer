"""Sanity-check NT tick-derived bars vs Yahoo: compare 1-min closes at matching UTC minutes.
Expect ~0 diff during the front-month period (06-26) and ~+basis after the roll (Yahoo tracks 09-26,
our continuous series is back-adjusted to 06-26 level)."""
import json, os, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
d = os.path.join(HERE, "..", "data")
nt = json.load(open(os.path.join(d, "NQ_30s.json")))
ya = json.load(open(os.path.join(d, "NQ_1min.json")))  # Yahoo 1-min
ntm = {}
for b in nt:                       # 30s -> last close in each minute
    ntm[b["time"] - (b["time"] % 60)] = b["close"]
yam = {b["time"] - (b["time"] % 60): b["close"] for b in ya}
common = sorted(set(ntm) & set(yam))
f = lambda t: datetime.datetime.utcfromtimestamp(t).strftime("%m/%d %H:%M")
print(f"common minutes: {len(common)}")
if common:
    ds = [abs(ntm[t] - yam[t]) for t in common]
    print(f"abs diff over all common: mean={sum(ds)/len(ds):.1f}  max={max(ds):.1f}")
    print("samples across the week:")
    for t in common[:: max(1, len(common) // 14)]:
        print(f"  {f(t)}  NT={ntm[t]:.2f}  Yahoo={yam[t]:.2f}  d={ntm[t]-yam[t]:+.2f}")
