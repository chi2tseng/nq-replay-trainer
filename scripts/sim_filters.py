"""Scalper filters on real trades: skip signals whose stop is wide relative to ATR; time stop. Usage: py sim_filters.py <trades...>"""
import sys, os, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])
def one(pp, tgt):
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
def summ(sel, tgt_fn):
    if not sel: return 'n=0'
    res = [(one(pp, max(1, round(tgt_fn(pp)))), pp['sl']) for pp in sel]; n = len(res); w = sum(1 for t, _ in res if t > 0); R = sum(t / s for t, s in res)
    return f"n={n:2} win {w/n*100:3.0f}% avgR {R/n:+.2f} sumR {R:+5.1f}"
print(f"stop/ATR ratio per trade: median {st.median(pp['sl']/pp['atr'] for pp in paths):.2f}, range {min(pp['sl']/pp['atr'] for pp in paths):.2f}..{max(pp['sl']/pp['atr'] for pp in paths):.2f}\n")
for lab, fn in [('40t', lambda pp: 40), ('0.5ATR', lambda pp: pp['atr'] * 0.5), ('1ATR', lambda pp: pp['atr'])]:
    print(f"target {lab}:")
    for cut in (None, 1.5, 1.2, 1.0, 0.8):
        sel = paths if cut is None else [pp for pp in paths if pp['sl'] <= cut * pp['atr']]
        print(f"   stop <= {str(cut)+'xATR' if cut else 'any    ':>8} : {summ(sel, fn)}")
