"""Fixed-tick target sweep 40..120 (step 10), original stop, 1 contract. Usage: py sim_fixed_sweep.py <trades...>"""
import sys, os
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])
def one(pp, tgt):
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
print()
for t in range(40, 130, 10):
    res = [(one(pp, t), pp['sl']) for pp in paths]; n = len(res)
    w = sum(1 for x, _ in res if x > 0); R = sum(x / s for x, s in res) / n; net = sum(x for x, _ in res)
    print(f"{t:>4}t | win {w}/{n} = {w/n*100:3.0f}% | avg R {R:+.2f} | net {net:+5d}t | ${net*5:+,}/ct")
