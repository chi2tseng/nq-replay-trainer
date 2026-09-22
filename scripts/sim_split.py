"""5 contracts: 4 at TP1 + 1 at TP2 (original stop; optional BE for the 5th once TP1 prints). Usage: py sim_split.py <bar> <trades...>"""
import sys, os, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]
src = open(os.path.join(HERE, 'sim_bartrail.py'), encoding='utf-8').read().split('def run(')[0]
src = src.replace("BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]", ""); exec(src)
def one(pp, tgt, be_after=None):
    stop = -pp['sl']
    for f in pp['fav']:
        if f <= stop: return stop
        if f >= tgt: return tgt
        if be_after is not None and f >= be_after: stop = max(stop, 0)
    return pp['fav'][-1] if pp['fav'] else 0
n = len(paths); print(f"{n} trades | stop median {st.median(pp['sl'] for pp in paths):.0f}t")
print(f"{'plan':>26} | win | net $ (5ct) | avg R")
def show(name, fn):
    res = [fn(pp) for pp in paths]; w = sum(1 for r in res if r > 0); tot = sum(res)
    print(f"{name:>26} | {w/n*100:3.0f}% | ${tot*5:>8,} | {sum(r/(5*pp['sl']) for r, pp in zip(res, paths))/n:+.3f}")
for t in (50, 100, 200): show(f'5 x {t}t', lambda pp, t=t: 5 * one(pp, t))
for t in (100, 150, 200):
    show(f'4x50 + 1x{t} (orig stop)', lambda pp, t=t: 4 * one(pp, 50) + one(pp, t))
    show(f'4x50 + 1x{t} (BE after 50)', lambda pp, t=t: 4 * one(pp, 50) + one(pp, t, 50))
