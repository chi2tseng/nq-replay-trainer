"""Pre-slice 3-min bars for each quiz question -> data/quiz_bars.json.

Keeps the standalone quiz page self-contained and instant: no 39 MB dataset load.
Per question: `pre` = complete bars before the entry bar, `form` = the entry bar AS OF THE
ENTRY SECOND (see below), `post` = the completed entry bar plus everything through the exit + tail.

Usage: py scripts/build_quiz_bars.py [trades.json] [bars.json]
  default set : py scripts/build_quiz_bars.py
  another set : py scripts/build_quiz_bars.py quiz2_trades.json quiz2_bars.json
"""
import json, os, bisect, datetime, sys
HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
TF = 180; PRE_BARS = 150; TAIL_BARS = 12
SRC = sys.argv[1] if len(sys.argv) > 1 else "quiz_trades.json"
DST = sys.argv[2] if len(sys.argv) > 2 else "quiz_bars.json"
bars = json.load(open(os.path.join(DATA, "NQ_db_1m.json")))
qs = json.load(open(os.path.join(DATA, SRC)))
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
    post = agg(eb, xb + (TAIL_BARS + 1) * TF)
    if not pre or not post: continue
    # The entry bar AS OF THE ENTRY INSTANT. Minutes that had fully closed before the entry
    # minute are used verbatim; the live minute contributes only the fill price, which IS where
    # price stood at that second. The bar therefore never carries a tick from after the entry —
    # the cost is dropping any wick the live minute printed before the fill (unknowable at 1-min).
    emin = (q["entryTime"] // 60) * 60                    # start of the minute the entry landed in
    done = agg(eb, emin)                                  # [] when the entry is in the bar's first minute
    ep = q["entry"]
    if done:
        b0 = done[0]
        form = {"t": eb, "o": b0["o"], "h": max(b0["h"], ep), "l": min(b0["l"], ep), "c": ep}
    else:
        first = agg(eb, eb + 60)
        o0 = first[0]["o"] if first else ep                # the bar's open predates the entry, so it is fair game
        form = {"t": eb, "o": o0, "h": max(o0, ep), "l": min(o0, ep), "c": ep}
    o = dict(q); o.pop("playable", None); o.pop("inBar", None); o.pop("revealTime", None)
    o["pre"] = pre; o["form"] = form; o["post"] = post
    o["formSec"] = int(q["entryTime"] - eb)               # seconds into the 3-min bar when the trigger was pulled
    o["formMin"] = int((emin - eb) / 60)                  # fully-closed minutes behind the live one
    out.append(o)

p = os.path.join(DATA, DST)
json.dump(out, open(p, "w"), separators=(",", ":"))
kb = os.path.getsize(p) / 1024
skipped = len(qs) - len(out)
print("wrote %s: %d questions, %.0f KB%s" % (os.path.basename(p), len(out), kb,
      ("  (SKIPPED %d — no bar data for those days)" % skipped) if skipped else ""))
c = {}
for q in out: c[q["formMin"]] = c.get(q["formMin"], 0) + 1
print("closed minutes behind the live one:", dict(sorted(c.items())))
bad = [q for q in out if abs(q["form"]["c"] - q["entry"]) > 1e-9]
print("form close == fill price:", "ALL OK" if not bad else "%d MISMATCH" % len(bad))
leak = [q for q in out if q["form"]["h"] > q["post"][0]["h"] + 1e-9 or q["form"]["l"] < q["post"][0]["l"] - 1e-9]
print("form range inside the completed bar:", "ALL OK" if not leak else "%d OUTSIDE" % len(leak))
same = [q for q in out if abs(q["form"]["c"] - q["post"][0]["c"]) < 1e-9 and abs(q["form"]["h"] - q["post"][0]["h"]) < 1e-9 and abs(q["form"]["l"] - q["post"][0]["l"]) < 1e-9]
print("questions where the partial still equals the finished bar:", len(same))
q0 = out[0]
print("sample q1 %s: form=%s" % (q0["etHM"], json.dumps(q0["form"])))
print("        completed bar=%s" % json.dumps(q0["post"][0]))
