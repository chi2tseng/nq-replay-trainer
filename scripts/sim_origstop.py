"""Keep each trade's ORIGINAL stop (stopTicks as traded), vary the target: which targets would have hit
before that stop? Also prints each trade's MFE-before-stop (the biggest target that was reachable).
Usage: py sim_origstop.py <trades.json|csv> [targets=40,60,80,100,120,160,200]"""
import sys, os, bisect
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
src = sys.argv[1]; targets = [int(x) for x in (sys.argv[2] if len(sys.argv) > 2 else '40,60,80,100,120,160,200').split(',')]
code = open(os.path.join(HERE, 'sim_bracket.py'), encoding='utf-8').read().split('rows = trades_from_json')[0]
sys.argv = [sys.argv[0], src, '40', '40']; exec(code)

def walk(tr):   # -> (mfe ticks before the original stop was hit, ticks at which the stop hit or None)
    ent = parse_et(tr['entryTime']); px = float(tr['entry']); long = tr['side'] == 'long'; sl = int(tr['stopTicks'])
    name, ms, p = tape(tr.get('sym') or 'NQ', trading_day(ent))
    ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    stop = px - sl * TICK if long else px + sl * TICK; mfe = 0
    for k in range(i + 1, len(p)):
        v = p[k]; fav = round(((v - px) if long else (px - v)) / TICK); mfe = max(mfe, fav)
        if (v <= stop) if long else (v >= stop): return mfe, True
    return mfe, False

rows = trades_from_json(src) if src.lower().endswith('.json') else trades_from_csv(src)
res = []
print(f"{'#':>2} {'side':5} {'entry':>9} {'stop':>5}  {'MFE before stop':>15}  reachable targets")
for tr in rows:
    mfe, stopped = walk(tr); res.append((tr, mfe, stopped))
    ent = parse_et(tr['entryTime'])
    print(f"{tr['idx']:>2} {tr['side']:5} {float(tr['entry']):9.2f} {int(tr['stopTicks']):>5}t  {mfe:>+12d}t {'(stopped)' if stopped else '(held to close)':>16}  {'≤' + str(mfe) + 't' if mfe else 'none'}")
print(f"\n{'target':>7} | {'W':>2} {'L':>2} {'win%':>5} {'net ticks':>10} {'$ / contract':>12}   (stop = your original per-trade stop)")
for tgt in targets:
    w = l = 0; net = 0
    for tr, mfe, stopped in res:
        if mfe >= tgt: w += 1; net += tgt
        elif stopped: l += 1; net -= int(tr['stopTicks'])
        else: pass
    print(f"{tgt:>6}t | {w:>2} {l:>2} {w / (w + l) * 100 if w + l else 0:>4.0f}% {net:>+10d} {net * 5:>+12.0f}")
