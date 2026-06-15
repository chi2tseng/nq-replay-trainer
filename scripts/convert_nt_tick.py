"""Convert NinjaTrader TICK export(s) -> 30-second OHLCV bars -> data/NQ_30s.json.
NT tick export line: "yyyyMMdd HHmmss fffffff;price;<bid>;<ask>;volume"  (timestamp is UTC).
We use field1 (trade/last price) for OHLC and the last field for volume.
Merges NQ 06-26 (front) + NQ 09-26 (post-roll tail), back-adjusting 09-26 to 06-26's level
so the continuous series has no roll gap. Streams the files (handles 150MB+).
"""
import json, os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DL = r"C:\Users\chi2t\Downloads"
OUT = os.path.normpath(os.path.join(HERE, "..", "data", "NQ_30s.json"))
BUCKET = 30  # seconds per bar
TICK = 0.25
def rt(x): return round(round(x / TICK) * TICK, 2)

def parse_sec(ts):
    # "20260607 220000 0960000" -> UTC epoch seconds
    d, hms, _frac = ts.split(" ")
    dt = datetime.datetime(int(d[0:4]), int(d[4:6]), int(d[6:8]),
                           int(hms[0:2]), int(hms[2:4]), int(hms[4:6]),
                           tzinfo=datetime.timezone.utc)
    return int(dt.timestamp())

def build(path):
    bars = {}  # bucket_epoch -> [o,h,l,c,v]
    n = 0
    with open(path, "r") as f:
        for line in f:
            p = line.rstrip("\n").split(";")
            if len(p) < 3:
                continue
            try:
                sec = parse_sec(p[0]); price = float(p[1]); vol = int(float(p[-1]))
            except Exception:
                continue
            n += 1
            b0 = sec - (sec % BUCKET)
            b = bars.get(b0)
            if b is None:
                bars[b0] = [price, price, price, price, vol]
            else:
                if price > b[1]: b[1] = price
                if price < b[2]: b[2] = price
                b[3] = price; b[4] += vol
    print(f"  {os.path.basename(path)}: {n} ticks -> {len(bars)} {BUCKET}s bars")
    return bars

print("parsing tick files...")
m06 = build(os.path.join(DL, "NQ 06-26.Last.txt"))
m09 = build(os.path.join(DL, "NQ 09-26.Last.txt"))

last06 = max(m06) if m06 else 0
off = 0.0
if m09 and m06:
    cand = [t for t in m09 if t <= last06]
    if cand:
        off = m06[last06][3] - m09[max(cand)][3]   # back-adjust 09-26 to 06-26 level

merged = dict(m06)
appended = 0
for t in sorted(m09):
    if t > last06:
        o, h, l, c, v = m09[t]
        merged[t] = [o + off, h + off, l + off, c + off, v]
        appended += 1

bars = []
for t in sorted(merged):
    o, h, l, c, v = merged[t]
    bars.append({"time": t, "open": rt(o), "high": rt(h), "low": rt(l), "close": rt(c), "volume": int(v)})

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, "w") as f:
    json.dump(bars, f)

print(f"wrote {len(bars)} 30s bars -> {OUT}")
print(f"  back-adjust offset (09-26 -> 06-26) = {off:.2f}, appended {appended} bars from 09-26")
if bars:
    f0 = datetime.datetime.utcfromtimestamp(bars[0]["time"])
    f1 = datetime.datetime.utcfromtimestamp(bars[-1]["time"])
    lo = min(b["low"] for b in bars); hi = max(b["high"] for b in bars)
    print(f"  range {f0} .. {f1} UTC   price {lo} .. {hi}")
