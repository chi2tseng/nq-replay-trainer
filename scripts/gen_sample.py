"""Generate placeholder NQ 1-min data so the platform runs before real data is loaded.
Stdlib only. Output: data/sample_NQ_1min.json  (array of {time, open, high, low, close, volume}).
time = UTC epoch seconds (Lightweight Charts intraday format).
Replaced later by the real NinjaTrader export via convert_export.py.
"""
import json, random, math, datetime, os

random.seed(42)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "data", "sample_NQ_1min.json"))

TICK = 0.25
def rt(p):  # round to tick
    return round(round(p / TICK) * TICK, 2)

bars = []
price = 29900.0
# 5 weekday RTH-ish sessions starting Mon 2026-06-01, 09:30 for 390 minutes each
day = datetime.date(2026, 6, 1)
sessions = 0
while sessions < 5:
    if day.weekday() < 5:  # Mon-Fri
        sessions += 1
        # mild intraday trend per day
        trend = random.uniform(-0.15, 0.15)
        open_t = datetime.datetime(day.year, day.month, day.day, 13, 30, tzinfo=datetime.timezone.utc)  # 09:30 ET ~ 13:30 UTC
        for i in range(390):
            o = price
            step = trend + random.uniform(-1, 1) * 2.5
            c = rt(o + step)
            hi = rt(max(o, c) + abs(random.gauss(0, 1)) * 1.5)
            lo = rt(min(o, c) - abs(random.gauss(0, 1)) * 1.5)
            vol = max(50, int(random.gauss(1200, 600)))
            ts = int((open_t + datetime.timedelta(minutes=i)).timestamp())
            bars.append({"time": ts, "open": rt(o), "high": hi, "low": lo, "close": c, "volume": vol})
            price = c
    day += datetime.timedelta(days=1)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(bars, f)
print(f"wrote {len(bars)} bars -> {OUT}")
print(f"range: {bars[0]['time']} .. {bars[-1]['time']}  price {bars[0]['open']} .. {bars[-1]['close']}")
