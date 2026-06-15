"""Fetch real NQ futures 1-min bars from Yahoo Finance -> data/NQ_1min.json (app format).
Free, no NinjaTrader needed. Stdlib only. Re-run anytime to refresh.
Env overrides: SYM (default NQ=F), RANGE (default 7d), INTERVAL (default 1m).
Note: Yahoo caps 1m history at ~7 days. For deeper history use a different source (e.g. Dukascopy).
"""
import json, os, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "data", "NQ_1min.json"))
SYM = os.environ.get("SYM", "NQ=F")
RANGE = os.environ.get("RANGE", "7d")
INTERVAL = os.environ.get("INTERVAL", "1m")
TICK = 0.25

url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(SYM)}?range={RANGE}&interval={INTERVAL}"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
data = json.load(urllib.request.urlopen(req, timeout=30))
res = data["chart"]["result"][0]
ts = res["timestamp"]
q = res["indicators"]["quote"][0]
o, h, l, c, v = q["open"], q["high"], q["low"], q["close"], q["volume"]

def rt(x):
    return round(round(x / TICK) * TICK, 2)

bars = []
for i, t in enumerate(ts):
    if o[i] is None or h[i] is None or l[i] is None or c[i] is None:
        continue
    bars.append({"time": int(t), "open": rt(o[i]), "high": rt(h[i]), "low": rt(l[i]), "close": rt(c[i]), "volume": int(v[i] or 0)})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(bars, f)

print(f"wrote {len(bars)} bars -> {OUT}")
if bars:
    f0 = datetime.datetime.utcfromtimestamp(bars[0]["time"])
    f1 = datetime.datetime.utcfromtimestamp(bars[-1]["time"])
    print(f"range {f0} .. {f1} UTC   price {bars[0]['open']} .. {bars[-1]['close']}")
