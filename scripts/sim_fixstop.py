"""Same as sim_final but every trade's stop forced to FIXSTOP ticks. Usage: py sim_fixstop.py <bar> <fixstop> <trades>"""
import sys, os, json, bisect, statistics as st
HERE = r'D:\Tools\replay-trainer\scripts'; sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); FIX = int(sys.argv[2]); sys.argv = [sys.argv[0]] + sys.argv[3:]
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0]
a, b = src.split('# ---- per trade')
exec(a)
for tr in trades: tr['stopTicks'] = str(FIX)
exec('# ---- per trade' + b)
def run(pp, tgt):
    sl = pp['sl']
    for f in pp['fav']:
        if f <= -sl: return -sl
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
print(f'{len(paths)} trades, stop fixed {FIX}t')
for tgt in (40, 50, 60, 80, 100, 110):
    res = [run(pp, tgt) for pp in paths]; n = len(res); w = sum(1 for t in res if t > 0); R = sum(t / FIX for t in res)
    print(f'{tgt:>4}t | win {w/n*100:3.0f}% | avg R {R/n:+.2f} | net {sum(res):+d}t = ${sum(res)*5:,} | plan 1:{tgt/FIX:.2f}')
