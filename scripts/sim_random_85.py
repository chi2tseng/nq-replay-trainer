"""How often do RANDOM signals (same frequency as pin bars, max N/day, one at a time) reach a target win rate?
And what stop size does a random entry need for that win rate with a 4t target?
Usage: py sim_random_85.py [--from 2026-09-01] [--to 2026-09-30] [--per-day 2] [--sims 5000] [--goal 85]
"""
import sys, os, numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS0 = sys.argv[1:]   # kept apart: the exec'd scripts redefine argv / opt / SIMS
def opt0(name, default): return ARGS0[ARGS0.index(name) + 1] if name in ARGS0 else default
sys.argv = [sys.argv[0], '--from', opt0('--from', '2026-09-01'), '--to', opt0('--to', '2026-09-30'), '--per-day', opt0('--per-day', '2'), '--sims', '1']
exec(open(os.path.join(HERE, 'sim_pinbar_perday.py'), encoding='utf-8').read().split('rng2 = np.random.default_rng(11)')[0])   # PRE, PER, days, walk()...
GOAL, SIMS = float(opt0('--goal', 85)), int(opt0('--sims', 5000))
rng3 = np.random.default_rng(85)
nbar = sum(len(v) for v in PRE.values()); freq = sum(1 for v in PRE.values() for r in v if r['pin']) / nbar
print(f"ES {a.bar}t {days[0]}..{days[-1]} ({len(days)} days), random signals at {freq * 100:.1f}% of RTH bars, max {PER}/day, target {a.tp}t, stop = signal bar extreme +/-1t, {SIMS} runs\n")
for mode, lab in (('R', 'REAL '), ('I', 'IDEAL')):
    wins, ns = [], []
    for _ in range(SIMS):
        out = []
        for d in days:
            busy, n = -1, 0
            for r, f in zip(PRE[d], rng3.random(len(PRE[d])) < freq):
                if n >= PER: break
                if not f or r['e'] <= busy or r['side'] == 0 or r[mode] is None: continue
                out.append(r[mode][0] > 0); busy = r[mode][1]; n += 1
        wins.append(np.mean(out) * 100); ns.append(len(out))
    w = np.array(wins)
    print(f"{lab} | trades/run ~{int(np.median(ns))} | median {np.median(w):.1f}% | 5-95% {np.percentile(w, 5):.1f}-{np.percentile(w, 95):.1f}% | max {w.max():.1f}% | P(win >= {GOAL:g}%) = {(w >= GOAL - 1e-9).mean() * 100:.1f}%")

if '--no-stops' in ARGS0: sys.exit(0)
# random time + side, fixed stop: win rate vs stop size (4t target), all RTH, 3000 entries per stop size
print(f"\nrandom time + random side, market entry, fixed stop, target {a.tp}t (3000 entries per row):")
print(f"{'stop':>5} | {'REAL win%':>9} | {'REAL $/trade':>12} | {'IDEAL win%':>10} | theory stop/(stop+tp)")
for stop_t in (8, 12, 16, 20, 24, 28, 32):
    rw, re, iw = [], [], []
    for _ in range(3000):
        d = days[rng3.integers(len(days))]; D = TAPES[d]; t, p = D['t'], D['p']
        i0, i1 = int(np.searchsorted(t, D['rth0'])), int(np.searchsorted(t, D['last'], 'right')) - 1
        if i1 <= i0: continue
        i = int(rng3.integers(i0, i1)); side = 1 if rng3.random() < .5 else -1
        for ideal in (False, True):
            entry = p[i] if ideal else p[i] + (D['ao'][i] if side > 0 else D['bo'][i])
            r = walk(D, i + 1, side, entry, entry - side * stop_t, entry + side * a.tp, ideal)
            if ideal: iw.append(r > 0)
            else: rw.append(r > 0); re.append(r * TV - COMM)
    print(f"{stop_t:>4}t | {np.mean(rw) * 100:8.1f}% | {np.mean(re):+12.2f} | {np.mean(iw) * 100:9.1f}% | {stop_t / (stop_t + a.tp) * 100:.1f}%")
