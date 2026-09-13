"""ATR period sweep (5/7/10/14/21) x multiple, target only, original stop, 1 contract. Usage: py sim_atr_periods.py <trades...>"""
import sys, os, bisect, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])
PERIODS = (5, 7, 10, 14, 21); MULTS = (0.5, 0.75, 1, 1.25, 1.5, 2)
for pp in paths:
    tr = pp['tr']; ent = parse_et(tr['entryTime']); name, ms, p = tape('NQ', trading_day(ent)); mb = minute_bars(ms, p); ems = int(ent.timestamp() * 1000)
    pp['atrs'] = {n: atr_at(mb, ems, n) / TICK for n in PERIODS}
def one(pp, tgt):
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
print(f"{len(paths)} trades, stop = original. cells = win% / avg R / net ticks per contract\n")
print(f"{'mult':>6} | " + ' | '.join(f"{'ATR'+str(n):^22}" for n in PERIODS))
best = []
for m in MULTS:
    cells = []
    for n in PERIODS:
        res = [(one(pp, max(1, round(pp['atrs'][n] * m))), pp['sl']) for pp in paths]
        w = sum(1 for t, _ in res if t > 0) / len(res) * 100; R = sum(t / s for t, s in res) / len(res); net = sum(t for t, _ in res)
        cells.append(f"{w:3.0f}% {R:+.2f} {net:+6d}t"); best.append((R, w, net, f'{m:g} x ATR{n}'))
    print(f"{m:>6g} | " + ' | '.join(f'{c:^22}' for c in cells))
print('\navg ATR at entry (ticks):', {n: round(st.mean(pp['atrs'][n] for pp in paths)) for n in PERIODS})
print('top 6 by avg R:'); [print(f"  {lab:>14}: win {w:3.0f}%  avg R {R:+.2f}  net {net:+d}t") for R, w, net, lab in sorted(best, reverse=True)[:6]]
