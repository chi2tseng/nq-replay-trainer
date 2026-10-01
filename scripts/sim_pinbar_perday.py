"""Pin bars, capped at N trades per day (first N that trigger, one position at a time), vs random signals at the same frequency.
Same bars / pin rules / brackets / fills as sim_pinbar_es.py (exec'd from it).
Usage: py sim_pinbar_perday.py [--from 2026-09-17] [--to 2026-09-30] [--per-day 2] [--sims 2000]
"""
import sys, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
argv = sys.argv[1:]
def opt(name, default):
    return argv[argv.index(name) + 1] if name in argv else default
PER, SIMS = int(opt('--per-day', 2)), int(opt('--sims', 2000))
sys.argv = [sys.argv[0], '--from', opt('--from', '2026-09-17'), '--to', opt('--to', '2026-09-30')]
src = open(os.path.join(HERE, 'sim_pinbar_es.py'), encoding='utf-8').read()
exec(src.split('def run_set(')[0])   # args, load(), bars_of(), pin_side(), TAPES, BARS, rth, days, constants

def trade(D, B, k, side, ideal):
    """like bracket() but also returns the exit print index. None if the next bar never triggers."""
    if k + 1 >= len(B): return None
    sb, nb = B[k], B[k + 1]; p = D['p']
    trig = sb['h'] + 1 if side > 0 else sb['l'] - 1
    stop = sb['l'] - 1 if side > 0 else sb['h'] + 1
    seg = p[nb['s']:nb['e'] + 1]
    hit = np.flatnonzero(seg >= trig) if side > 0 else np.flatnonzero(seg <= trig)
    if not len(hit): return None
    i = nb['s'] + int(hit[0])
    if i > D['close']: return None
    fill = trig if ideal else (max(trig, p[i] + max(0, D['ao'][i])) if side > 0 else min(trig, p[i] + min(0, D['bo'][i])))
    tgt = fill + side * a.tp; end = D['close']; s0 = i + 1
    if s0 > end: return (p[end] - fill) * side, end, (fill - stop) * side
    seg = p[s0:end + 1] * side; th = tgt * side + (0 if ideal else 1); sh = stop * side
    g = np.flatnonzero(seg >= th); l = np.flatnonzero(seg <= sh)
    g = g[0] if len(g) else 1 << 60; l = l[0] if len(l) else 1 << 60
    if g < l: return a.tp, s0 + g, (fill - stop) * side
    if l < g: return ((stop if ideal else p[s0 + l]) - fill) * side, s0 + l, (fill - stop) * side
    return (p[end] - fill) * side, end, (fill - stop) * side

# precompute every RTH bar once: its colour side, pin side, and the trade it would make (REAL / IDEAL)
PRE = {}
for d in days:
    D, B = TAPES[d], BARS[d]; rows = []
    for k, b in enumerate(B):
        if not rth(D, b): continue
        side = 1 if b['c'] > b['o'] else -1 if b['c'] < b['o'] else 0
        rows.append({'k': k, 'e': b['e'], 'side': side, 'pin': pin_side(b, 0.60, 0.20), 'tc': b['tc'],
                     'R': trade(D, B, k, side, False) if side else None, 'I': trade(D, B, k, side, True) if side else None})
    PRE[d] = rows

def capped(flag, mode, cap):
    """walk each day's bars in order; when flat take the first flagged bar whose order triggers; at most `cap` trades/day"""
    out = []
    for d in days:
        busy_until, n = -1, 0
        for r in PRE[d]:
            if n >= cap: break
            if r['e'] <= busy_until or not flag(r): continue
            t = r[mode]
            if t is None: continue
            out.append((t[0], t[2], d, r['tc'])); busy_until = t[1]; n += 1
    return out

def stats(tr, ideal):
    if not tr: return None
    res = np.array([x[0] for x in tr], float); st = np.array([x[1] for x in tr], float)
    return dict(n=len(tr), win=(res > 0).mean() * 100, ev=res.mean() * TV - (0 if ideal else COMM),
                be=np.mean((st * TV + (0 if ideal else COMM)) / ((st + a.tp) * TV)) * 100, stop=np.median(st))

rng2 = np.random.default_rng(11)
nbar = sum(len(v) for v in PRE.values()); npin = sum(1 for v in PRE.values() for r in v if r['pin'])
freq = npin / nbar
print(f"ES {a.bar}t {days[0]}..{days[-1]} ({len(days)} days), RTH signal bars {nbar}, pin bars {npin} ({freq * 100:.1f}% of bars), target {a.tp}t, max {PER}/day, one position at a time\n")
print(f"{'fills':<5} | {'rule':<28} | {'trades':>6} | {'win%':>5} | {'$/trade':>8} | {'BE win%':>7} | random signals same freq, {PER}/day: median win% [5%-95%] | pins' percentile")
for mode, ideal in (('R', False), ('I', True)):
    pins = capped(lambda r: r['pin'] != 0, mode, PER); sp = stats(pins, ideal)
    sims = []
    for _ in range(SIMS):
        flags = {d: rng2.random(len(PRE[d])) < freq for d in days}
        out = []
        for d in days:
            busy, n = -1, 0
            for r, f in zip(PRE[d], flags[d]):
                if n >= PER: break
                if not f or r['e'] <= busy or r['side'] == 0: continue
                t = r[mode]
                if t is None: continue
                out.append(t[0] > 0); busy = t[1]; n += 1
        if out: sims.append(np.mean(out) * 100)
    sims = np.array(sims); pct = (sims < sp['win']).mean() * 100 + (sims == sp['win']).mean() * 50
    lab = 'REAL' if not ideal else 'IDEAL'
    print(f"{lab:<5} | {'pins, first ' + str(PER) + '/day':<28} | {sp['n']:>6} | {sp['win']:5.1f} | {sp['ev']:+8.2f} | {sp['be']:6.1f}% | {np.median(sims):5.1f}% [{np.percentile(sims, 5):.1f}-{np.percentile(sims, 95):.1f}] | {pct:.0f}th")
    allp = stats(capped(lambda r: r['pin'] != 0, mode, 999), ideal)
    print(f"{lab:<5} | {'pins, all (1 at a time)':<28} | {allp['n']:>6} | {allp['win']:5.1f} | {allp['ev']:+8.2f} | {allp['be']:6.1f}% |")
    anyf = stats(capped(lambda r: r['side'] != 0, mode, PER), ideal)
    print(f"{lab:<5} | {'any bar, first ' + str(PER) + '/day':<28} | {anyf['n']:>6} | {anyf['win']:5.1f} | {anyf['ev']:+8.2f} | {anyf['be']:6.1f}% |")
import datetime as _dt
times = [_dt.datetime.fromtimestamp(x[3] / 1000, ET).strftime('%H:%M') for x in capped(lambda r: r['pin'] != 0, 'R', PER)]
print(f"\nwhen the capped pin trades happen (signal bar close, ET): median {sorted(times)[len(times) // 2]}, before 10:00 {sum(t < '10:00' for t in times)}, 10:00-11:30 {sum('10:00' <= t < '11:30' for t in times)}, after 11:30 {sum(t >= '11:30' for t in times)}")
P = capped(lambda r: r['pin'] != 0, 'R', PER)
print('per day (REAL, win/trades): ' + '  '.join(f"{d[5:]} {sum(1 for x in P if x[2] == d and x[0] > 0)}/{sum(1 for x in P if x[2] == d)}" for d in days))
