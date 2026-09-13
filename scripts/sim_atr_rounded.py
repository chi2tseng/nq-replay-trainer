"""Practical ATR rule: read ATR once, round the target to a coarse step (e.g. 5 points = 20 ticks), keep it fixed.
Variants: ATR at entry vs ATR at 09:30 (set once per day), multiplier k, round down / nearest.
Usage: py sim_atr_rounded.py <trades...> [--k 1.0] [--step 20]"""
import sys, os, bisect, statistics as st, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
K = float(sys.argv[sys.argv.index('--k') + 1]) if '--k' in sys.argv else 1.0
STEP = int(sys.argv[sys.argv.index('--step') + 1]) if '--step' in sys.argv else 20
sys.argv = [a for a in sys.argv if a not in ('--k', '--step', str(K), str(STEP))]
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])
def one(pp, tgt):
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
# ATR at the 09:30 open of each trade's day (what you'd read once before trading)
for pp in paths:
    tr = pp['tr']; ent = parse_et(tr['entryTime']); name, ms, p = tape('NQ', trading_day(ent))
    open_ms = int(ent.replace(hour=9, minute=30, second=0, microsecond=0).timestamp() * 1000)
    pp['atr_open'] = atr_at(minute_bars(ms, p), open_ms + 60000 * 10) / TICK   # ATR(10) as of 09:40 (needs 10 RTH bars)
def summ(label, tgt_fn):
    res = [(one(pp, max(STEP, tgt_fn(pp))), pp['sl']) for pp in paths]; n = len(res); w = sum(1 for t, _ in res if t > 0); R = sum(t / s for t, s in res)
    tg = [max(STEP, tgt_fn(pp)) for pp in paths]
    print(f"{label:>34} | win {w/n*100:3.0f}% | avgR {R/n:+.2f} | net {sum(t for t,_ in res):+5d}t | targets used: {sorted(set(tg))}")
rd = lambda x: int(x // STEP) * STEP; rn = lambda x: int(round(x / STEP)) * STEP
print(f"{len(paths)} trades, k={K}, step={STEP} ticks ({STEP/4:g} pt)\n")
summ('40t fixed', lambda pp: 40)
summ(f'exact {K:g}xATR @entry', lambda pp: round(K * pp['atr']))
summ(f'{K:g}xATR @entry, round DOWN {STEP/4:g}pt', lambda pp: rd(K * pp['atr']))
summ(f'{K:g}xATR @entry, round NEAREST {STEP/4:g}pt', lambda pp: rn(K * pp['atr']))
summ(f'{K:g}xATR @09:40, round DOWN {STEP/4:g}pt', lambda pp: rd(K * pp['atr_open']))
summ(f'{K:g}xATR @09:40, round NEAREST {STEP/4:g}pt', lambda pp: rn(K * pp['atr_open']))
summ(f'exact {K:g}xATR @09:40', lambda pp: round(K * pp['atr_open']))
