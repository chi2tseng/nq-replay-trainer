"""Pre-slice 3-min bars for each quiz question -> data/quiz_bars.json.

Keeps the standalone quiz page self-contained and instant: no 39 MB dataset load.
Per question: `pre` = complete bars before the entry bar, `form` = the entry bar
as it stood at the minute of the real entry (true OHLC of the revealed minutes),
`post` = the completed entry bar plus everything through the exit + tail.

Usage: py scripts/build_quiz_bars.py
"""
import json, os, bisect, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
TF = 180; PRE_BARS = 150; TAIL_BARS = 12
bars = json.load(open(os.path.join(DATA, "NQ_db_1m.json")))
qs = json.load(open(os.path.join(DATA, "quiz_trades.json")))
bt = [b["time"] for b in bars]

def agg(lo_t, hi_t):                      # aggregate 1-min bars into 3-min buckets over [lo_t, hi_t)
    i = bisect.bisect_left(bt, lo_t); out = []; cur = None
    while i < len(bars) and bars[i]["time"] < hi_t:
        b = bars[i]; k = (b["time"] // TF) * TF
        if cur is None or cur["t"] != k:
            cur = {"t": k, "o": b["open"], "h": b["high"], "l": b["low"], "c": b["close"]}; out.append(cur)
        else:
            cur["h"] = max(cur["h"], b["high"]); cur["l"] = min(cur["l"], b["low"]); cur["c"] = b["close"]
        i += 1
    return out

out = []
for q in qs:
    eb = (q["entryTime"] // TF) * TF                      # entry bar bucket
    xb = (q["exitTime"] // TF) * TF                       # exit bar bucket
    pre = agg(eb - PRE_BARS * TF, eb)
    emin = (q["entryTime"] // 60) * 60                    # minute the entry landed in
    form_src = agg(eb, emin + 60)                         # only the minutes up to and including the entry minute
    post = agg(eb, xb + (TAIL_BARS + 1) * TF)
    if not pre or not form_src or not post: continue
    o = dict(q); o.pop("playable", None); o.pop("inBar", None); o.pop("revealTime", None)
    o["pre"] = pre; o["form"] = form_src[0]; o["post"] = post
    o["formMin"] = int((emin + 60 - eb) / 60)             # how many of the 3 minutes are revealed
    out.append(o)

p = os.path.join(DATA, "quiz_bars.json")
json.dump(out, open(p, "w"), separators=(",", ":"))
kb = os.path.getsize(p) / 1024
print("wrote %s: %d questions, %.0f KB" % (os.path.basename(p), len(out), kb))
c = {}
for q in out: c[q["formMin"]] = c.get(q["formMin"], 0) + 1
print("minutes of the entry bar revealed:", dict(sorted(c.items())))
q0 = out[0]
print("sample q1: pre=%d bars, post=%d bars, form=%s" % (len(q0["pre"]), len(q0["post"]), json.dumps(q0["form"])))
print("  form vs completed entry bar:", json.dumps(q0["post"][0]))
