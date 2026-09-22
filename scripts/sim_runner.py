"""5 contracts: 4 exit at TP, 1 runner -> after TP prints, stop to breakeven, then bar-trail on own N-tick bars
(bar closes in our favour -> stop = that bar's adverse extreme +/-1t, tighten only). Runner has no fixed target.
Usage: py sim_runner.py <bar_ticks> <tp_ticks> <trades...>"""
import sys, os, json, bisect, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); _TP = int(sys.argv[2]); sys.argv = [sys.argv[0]] + sys.argv[3:]
src = open(os.path.join(HERE, 'sim_bartrail.py'), encoding='utf-8').read().split('def run(')[0]
src = src.replace("BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]", ""); exec(src); TP = _TP
def runner(pp, trail=True, be=True, from_entry=False):
    """returns (ticks for 1 runner contract, bars held after TP)"""
    sl = pp['sl']; fav = pp['fav']; bars = pp['bars']; stop = -sl; bi = 0; armed = False; k_tp = None
    for k, f in enumerate(fav):
        if f <= stop: return stop, (bi - (armed_bi if armed else bi))
        if not armed and f >= TP: armed = True; k_tp = k; armed_bi = bi
        if armed and be: stop = max(stop, 0)
        if bi < len(bars) and k == bars[bi][3]:
            o, c, worst, _ = bars[bi]; bi += 1
            if (armed or from_entry) and trail and c > o: stop = max(stop, worst - 1)
    return (fav[-1] if fav else 0), (bi - armed_bi if armed else 0)
def fixed(pp):
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= TP: return TP
    return pp['fav'][-1] if pp['fav'] else 0
rows = []
for pp in paths:
    fx = fixed(pp); rn, held = runner(pp); rn2, _ = runner(pp, be=False); rn3, _ = runner(pp, be=False, from_entry=True)
    rows.append({'t': str(pp['tr']['entryTime'])[:11], 'sl': pp['sl'], 'fixed5': 5 * fx, 'combo': 4 * fx + rn, 'combo_nobe': 4 * fx + rn2, 'combo_trail_entry': 4 * fx + rn3, 'runner': rn, 'runner_nobe': rn2, 'runner_te': rn3, 'held': held, 'win': fx > 0})
n = len(rows); w = sum(r['win'] for r in rows)
print(f"{n} trades | TP {TP}t | stop median {st.median(r['sl'] for r in rows):.0f}t")
for name, key in (('5 x fixed 50t', 'fixed5'), ('4 fixed + 1 runner BE', 'combo'), ('4 fixed + 1 runner noBE', 'combo_nobe'), ('4 fixed + 1 trail-from-entry', 'combo_trail_entry')):
    tot = sum(r[key] for r in rows); R = sum(r[key] / (5 * r['sl']) for r in rows) / n
    print(f"  {name:>28}: net {tot:+6d}t = ${tot*5:>7,}  | avg R {R:+.3f} (risk = 5 x stop) | per-contract {tot/5/n:+.1f}t/trade")
rs = [r['runner'] for r in rows if r['win']]
print(f"  runner alone (winners only, n={len(rs)}): avg {st.mean(rs):+.1f}t, median {st.median(rs):+.0f}t, max {max(rs)}t, ended >= +50t on {sum(1 for x in rs if x >= TP)}/{len(rs)}, back to BE (0) on {sum(1 for x in rs if x <= 0)}/{len(rs)}; bars held after TP median {st.median(r['held'] for r in rows if r['win']):.0f}")
print(f"  win rate {w/n*100:.0f}% (same for both)")

for lab, key in (('runner noBE', 'runner_nobe'), ('runner trail-from-entry', 'runner_te')):
    rs = [r[key] for r in rows if r['win']]
    print(f"  {lab} (winners only): avg {st.mean(rs):+.1f}t, median {st.median(rs):+.0f}t, max {max(rs)}t, ended >= +50t on {sum(1 for x in rs if x >= TP)}/{len(rs)}, ended <= 0 on {sum(1 for x in rs if x <= 0)}/{len(rs)}, hit original stop on {sum(1 for x, r in zip(rs, [r for r in rows if r['win']]) if x <= -r['sl'])}")
