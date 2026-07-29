"""Build data/quiz_trades.json from a broker fills export (data/trades_raw.txt).

Export columns: sym, qty, buyPrice, buyTime, duration, sellTime, sellPrice, pnl.
Timestamps are the trading platform local clock = JST here (verified 55/55 by checking
each entry price falls inside its 1-min bar; UTC+8 scored 2/55, UTC+9 scored 55/55).
Bought-first = long, sold-first = short. Entry = the earlier leg.

Usage: py scripts/build_quiz.py
"""
import json, re, datetime, os, sys
SCR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
TPE = datetime.timezone(datetime.timedelta(hours=9))   # broker log is JST (machine tz = Tokyo) - verified 55/55 by price-in-bar probe
try:
    from zoneinfo import ZoneInfo; ET = ZoneInfo("America/New_York")
except Exception:
    ET = datetime.timezone(datetime.timedelta(hours=-4))
PT_VALUE = 2.0   # MNQ = $2 per point

def ts(s):
    return int(datetime.datetime.strptime(s.strip(), "%m/%d/%Y %H:%M:%S").replace(tzinfo=TPE).timestamp())
def money(s):
    s = s.strip().replace("$", "").replace(",", "")
    neg = s.startswith("(")
    return (-1 if neg else 1) * float(s.strip("()"))

rows, bad = [], []
for ln in open(os.path.join(SCR, "trades_raw.txt"), encoding="utf-8"):
    ln = ln.rstrip("\n")
    if not ln.strip(): continue
    p = [x for x in re.split(r"\t+|\s{2,}", ln) if x.strip()]
    if len(p) != 8: bad.append(("cols=%d" % len(p), ln)); continue
    sym, qty, bpx, bt, dur, st, spx, pnl = p
    qty = int(qty); bpx = float(bpx); spx = float(spx); pnl = money(pnl)
    bt, st = ts(bt), ts(st)
    calc = (spx - bpx) * qty * PT_VALUE                      # buy leg vs sell leg
    if abs(calc - pnl) > 0.51: bad.append(("pnl %s vs %s" % (calc, pnl), ln)); continue
    long_ = bt < st                                          # bought first = long
    rows.append({"sym": sym, "qty": qty, "side": "long" if long_ else "short",
                 "entryTime": bt if long_ else st, "entry": bpx if long_ else spx,
                 "exitTime": st if long_ else bt, "exit": spx if long_ else bpx,
                 "pnl": pnl, "pts": round((spx - bpx) * (1 if long_ else 1), 2)})
rows.sort(key=lambda r: r["entryTime"])
for r in rows:
    d = datetime.datetime.fromtimestamp(r["entryTime"], ET)
    r["day"] = d.strftime("%Y-%m-%d"); r["etHM"] = d.strftime("%H:%M")
    r["holdMin"] = round((r["exitTime"] - r["entryTime"]) / 60, 1)

print("parsed %d rows, %d bad" % (len(rows), len(bad)))
for b in bad[:5]: print("  BAD:", b)

bars = json.load(open(r"D:\Tools\replay-trainer\data\NQ_db_1m.json"))
bt = [b["time"] for b in bars]
lo, hi = bt[0], bt[-1]
import bisect
ok = 0
for r in rows:
    bucket = (r["entryTime"] // 180) * 180                    # 3-min bucket containing the entry
    r["revealTime"] = bucket - 180                            # last CLOSED 3m bar before the entry bar
    have_pre = lo <= r["revealTime"]
    have_post = hi >= r["exitTime"]
    r["playable"] = bool(have_pre and have_post)
    # entry price sanity: is the entry inside the 3m bar's range?
    i = bisect.bisect_left(bt, bucket)
    if i < len(bars) and bt[i] < bucket + 180:
        seg = [b for b in bars[i:i+3] if b["time"] < bucket + 180]
        if seg:
            h = max(s["high"] for s in seg); l = min(s["low"] for s in seg)
            r["inBar"] = bool(l - 3 <= r["entry"] <= h + 3)
    ok += r["playable"]
print("playable: %d / %d" % (ok, len(rows)))
miss = [(r["day"], r["etHM"]) for r in rows if not r["playable"]]
if miss: print("not playable:", miss)
inbar = [r for r in rows if r.get("inBar") is not None]
print("entry-price-inside-bar check: %d/%d ok" % (sum(1 for r in inbar if r["inBar"]), len(inbar)))
offs = [(r["day"], r["etHM"], r["entry"]) for r in inbar if not r["inBar"]]
if offs: print("  price mismatch:", offs[:6])
w = [r for r in rows if r["pnl"] > 0]; l = [r for r in rows if r["pnl"] < 0]
print("real record: %d trades, %dW %dL %dBE, net $%.2f" % (len(rows), len(w), len(l), len(rows)-len(w)-len(l), sum(r["pnl"] for r in rows)))
print("days:", len(set(r["day"] for r in rows)), "| longs", sum(1 for r in rows if r["side"]=="long"), "shorts", sum(1 for r in rows if r["side"]=="short"))
out = [r for r in rows if r["playable"]]
for i, r in enumerate(out): r["id"] = i + 1
json.dump(out, open(r"D:\Tools\replay-trainer\data\quiz_trades.json", "w"), separators=(",", ":"))
print("wrote data/quiz_trades.json with %d questions" % len(out))
print("sample:", json.dumps(out[0]))
