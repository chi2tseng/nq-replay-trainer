"""Pin-bar setup vs random, ES 2000t (NinjaTrader tape: 1 tick = 1 print, 2000 prints per bar), RTH.

Setup (user's two bars):
  bull pin = GREEN bar, long lower tail, body near the high  -> buy stop  at high + 1t, stop at low  - 1t, target +4t
  bear pin = RED bar,  long upper tail, body near the low    -> sell stop at low  - 1t, stop at high + 1t, target -4t
  order lives for the NEXT bar only (cancelled if not triggered); flat at 16:00 ET.
Baselines (same entry / stop / target mechanics unless noted):
  B1 any bar      : every RTH bar, green -> long above the high, red -> short below the low
  B2 range-matched: B1 re-weighted to the pin trades' stop-size mix (removes "pins have bigger stops")
  B3 random time  : random time + random side, market entry, each pin trade's own stop size, target 4t (pure R:R coin flip)
Fills: IDEAL = stop entries at the trigger, target on touch, stop at its price, no commission.
       REAL  = entry at the triggering print (+ask/-bid offset), target must trade THROUGH (+1t), stop at the print that hits it, $4.50 RT.
Usage: py sim_pinbar_es.py [--from 2026-09-17] [--to 2026-09-30] [--sym ES]
"""
import json, os, glob, datetime, argparse, math
import numpy as np
from zoneinfo import ZoneInfo
ap = argparse.ArgumentParser(); ap.add_argument('--from', dest='d0', default='2026-09-17'); ap.add_argument('--to', dest='d1', default='2026-09-30')
ap.add_argument('--sym', default='ES'); ap.add_argument('--bar', type=int, default=2000); ap.add_argument('--tp', type=int, default=4)
a = ap.parse_args()
ET = ZoneInfo('America/New_York'); T = 0.25; TV = {'ES': 12.5, 'NQ': 5.0}[a.sym]; COMM = 4.5
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'tick')
PIN_DEFS = {'main (tail>=60%, other wick<=20%)': (0.60, 0.20), 'strict (tail>=67%, other<=10%)': (2 / 3, 0.10), 'loose (tail>=50%, other<=25%)': (0.50, 0.25)}
rng = np.random.default_rng(7)

def load(day):
    f = os.path.join(DATA, f'{a.sym}_{day}.nt.json')
    if not os.path.exists(f): return None
    d = json.load(open(f)); t = d['t0'] + np.asarray(d['dt'], dtype=np.int64)
    y, m, dd = map(int, day.split('-')); ts = lambda h, mi: int(datetime.datetime(y, m, dd, h, mi, tzinfo=ET).timestamp() * 1000)
    p = np.round(np.asarray(d['p']) / T).astype(np.int64)            # prices in ticks
    return {'t': t, 'p': p, 'bo': np.asarray(d['bo'], dtype=np.int64), 'ao': np.asarray(d['ao'], dtype=np.int64),
            'rth0': ts(9, 30), 'last': ts(15, 50), 'close': int(np.searchsorted(t, ts(16, 0), 'right')) - 1}

def bars_of(D):   # NT tick bars: a new bar starts after exactly BAR prints
    n = len(D['p']); s = np.arange(0, n, a.bar); e = np.minimum(s + a.bar, n) - 1
    p = D['p']; return [{'s': int(i), 'e': int(j), 'o': int(p[i]), 'c': int(p[j]), 'h': int(p[i:j + 1].max()), 'l': int(p[i:j + 1].min()), 'tc': int(D['t'][j])} for i, j in zip(s, e)]

def walk(D, start, side, entry, stop, tgt, ideal):
    """from print `start` (first print after the fill), stop/target in ticks -> result ticks per contract"""
    p = D['p']; end = D['close']
    if start > end: return (p[end] - entry) * side
    seg = p[start:end + 1] * side; th = tgt * side + (0 if ideal else 1); sh = stop * side
    g = np.flatnonzero(seg >= th); l = np.flatnonzero(seg <= sh)
    g = g[0] if len(g) else 1 << 60; l = l[0] if len(l) else 1 << 60
    if g < l: return (tgt - entry) * side
    if l < g: return ((stop if ideal else p[start + l]) - entry) * side   # REAL: the print that hit the stop (slippage on gaps)
    return (p[end] - entry) * side

def bracket(D, B, k, side, ideal):
    """signal bar B[k]; stop order for the next bar only. Returns (result ticks, stop ticks) or None if not triggered."""
    if k + 1 >= len(B): return None
    sb, nb = B[k], B[k + 1]; p = D['p']
    trig = sb['h'] + 1 if side > 0 else sb['l'] - 1
    stop = sb['l'] - 1 if side > 0 else sb['h'] + 1
    seg = p[nb['s']:nb['e'] + 1]
    hit = np.flatnonzero(seg >= trig) if side > 0 else np.flatnonzero(seg <= trig)
    if not len(hit): return None
    i = nb['s'] + int(hit[0])
    if i > D['close']: return None   # triggered after the 16:00 flat time: no trade
    if ideal: fill = trig
    else: fill = max(trig, p[i] + max(0, D['ao'][i])) if side > 0 else min(trig, p[i] + min(0, D['bo'][i]))
    if (fill - stop) * side <= 0: return None
    return walk(D, i + 1, side, fill, stop, fill + side * a.tp, ideal), (fill - stop) * side

def pin_side(b, tail, other):
    R = b['h'] - b['l']
    if R < 4: return 0
    top, bot = max(b['o'], b['c']), min(b['o'], b['c'])
    if b['c'] > b['o'] and (bot - b['l']) >= tail * R and (b['h'] - top) <= other * R: return 1
    if b['c'] < b['o'] and (b['h'] - top) >= tail * R and (bot - b['l']) <= other * R: return -1
    return 0

days = sorted({os.path.basename(f)[len(a.sym) + 1:len(a.sym) + 11] for f in glob.glob(os.path.join(DATA, f'{a.sym}_2026-*.nt.json'))})
days = [d for d in days if a.d0 <= d <= a.d1]
TAPES = {d: load(d) for d in days}; BARS = {d: bars_of(D) for d, D in TAPES.items()}
rth = lambda D, b: D['rth0'] <= b['tc'] <= D['last']
nbars = sum(1 for d in days for b in BARS[d] if rth(TAPES[d], b))

def run_set(select, ideal):
    out = []   # (result ticks, stop ticks, day)
    for d in days:
        D, B = TAPES[d], BARS[d]
        for k, b in enumerate(B):
            if not rth(D, b): continue
            side = select(b)
            if not side: continue
            r = bracket(D, B, k, side, ideal)
            if r: out.append((r[0], r[1], d))
    return out

def summ(rs, ideal):
    if not rs: return dict(n=0, win=float('nan'), ev=float('nan'), stop=float('nan'), be=float('nan'))
    res = np.array([r[0] for r in rs], float); st = np.array([r[1] for r in rs], float)
    ev = res.mean() * TV - (0 if ideal else COMM)
    be = np.mean((st * TV + (0 if ideal else COMM)) / ((st + a.tp) * TV))   # win rate needed to break even at these stops
    return dict(n=len(rs), win=(res > 0).mean() * 100, ev=ev, stop=np.median(st), be=be * 100, wins=int((res > 0).sum()))

def matched(base, ref, ideal):   # re-weight `base` trades to the stop-size mix of `ref` (buckets of 2 ticks)
    bk = lambda s: int(s // 2)
    want = {}; [want.__setitem__(bk(r[1]), want.get(bk(r[1]), 0) + 1) for r in ref]
    have = {}; [have.setdefault(bk(r[1]), []).append(r) for r in base]
    wins = ev = wsum = 0.0; miss = 0
    for b, cnt in want.items():
        pool = have.get(b)
        if not pool: miss += cnt; continue
        res = np.array([r[0] for r in pool], float); w = cnt
        wins += w * (res > 0).mean(); ev += w * (res.mean() * TV - (0 if ideal else COMM)); wsum += w
    return dict(win=wins / wsum * 100, ev=ev / wsum, miss=miss)

def random_time(ref, ideal, n_per=200):   # B3: random RTH time + side, market entry, the pin trade's own stop, target tp
    wins = []; evs = []
    for _, stop_t, d in ref:
        D = TAPES[d]; t, p = D['t'], D['p']
        i0, i1 = int(np.searchsorted(t, D['rth0'])), int(np.searchsorted(t, D['last'], 'right')) - 1
        for i in rng.integers(i0, i1, n_per):
            side = 1 if rng.random() < .5 else -1
            entry = p[i] if ideal else p[i] + (D['ao'][i] if side > 0 else D['bo'][i])
            r = walk(D, i + 1, side, entry, entry - side * stop_t, entry + side * a.tp, ideal)
            wins.append(r > 0); evs.append(r * TV - (0 if ideal else COMM))
    return dict(win=np.mean(wins) * 100, ev=np.mean(evs))

def binom_p_ge(k, n, p0):   # P(X >= k), X ~ Bin(n, p0)
    return sum(math.comb(n, j) * p0 ** j * (1 - p0) ** (n - j) for j in range(k, n + 1))

print(f'{a.sym} {a.bar}t, RTH signal bars closing 09:30-15:50 ET, {days[0]}..{days[-1]} ({len(days)} days, {nbars} RTH bars), target {a.tp}t, entry/stop = signal bar extreme +/-1t, next bar only\n')
anyb = lambda b: 1 if b['c'] > b['o'] else -1 if b['c'] < b['o'] else 0
for mode in ('REAL', 'IDEAL'):
    ideal = mode == 'IDEAL'
    B1 = run_set(anyb, ideal); s1 = summ(B1, ideal)
    print(f'===== {mode} fills ' + ('(touch, no costs)' if ideal else '(spread, trade-through target, $4.50 RT)') + ' =====')
    print(f"{'set':<34} | {'trades':>6} | {'win%':>6} | {'$/trade':>8} | {'med stop':>8} | {'BE win%':>7} | matched any-bar win% / $ | random-time win% / $ | p(setup>=matched)")
    print(f"{'B1 any bar (green long / red short)':<34} | {s1['n']:>6} | {s1['win']:6.1f} | {s1['ev']:+8.2f} | {s1['stop']:6.0f}t | {s1['be']:6.1f}% |")
    for name, (tail, other) in PIN_DEFS.items():
        P = run_set(lambda b: pin_side(b, tail, other), ideal); s = summ(P, ideal)
        if not P: print(f'{name:<34} | none'); continue
        m = matched(B1, P, ideal); rt = random_time(P, ideal)
        pv = binom_p_ge(s['wins'], s['n'], m['win'] / 100); um = f" ({m['miss']} unmatched)" if m['miss'] else ''
        print(f"{name:<34} | {s['n']:>6} | {s['win']:6.1f} | {s['ev']:+8.2f} | {s['stop']:6.0f}t | {s['be']:6.1f}% | {m['win']:6.1f}% / {m['ev']:+7.2f}{um} | {rt['win']:6.1f}% / {rt['ev']:+7.2f} | {pv:.3f}")
    print()
P = run_set(lambda b: pin_side(b, 0.6, 0.2), False)
print('main pin set, REAL fills, by side:')
longs = run_set(lambda b: 1 if pin_side(b, 0.6, 0.2) == 1 else 0, False); shorts = run_set(lambda b: -1 if pin_side(b, 0.6, 0.2) == -1 else 0, False)
for nm, S in (('bull pin long', longs), ('bear pin short', shorts)):
    s = summ(S, False); print(f"  {nm:<15} n={s['n']:>3}  win {s['win']:5.1f}%  $/trade {s['ev']:+7.2f}  BE {s['be']:.1f}%")
print('\nmain pin set per day (REAL): ' + '  '.join(f"{d[5:]} {sum(1 for r in P if r[2] == d)}t/{sum(1 for r in P if r[2] == d and r[0] > 0)}w" for d in days))
