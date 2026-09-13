"""Full grid: every take-profit rule x every stop-management rule, on real trades replayed over the tick tape
(same entry price/time, ORIGINAL per-trade stop). Writes exports/tp_grid.csv and prints the leaders.

Usage: py sim_tp_grid.py <trades.csv|.json> [more...]
"""
import sys, os, csv, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0]
exec(src)   # -> trades, paths (fav path per trade until original stop), TICK

TARGETS = [(f'{t}t', lambda pp, t=t: t) for t in (40, 50, 60, 80, 100, 120, 160, 200)] + \
          [(f'{k:g}R', lambda pp, k=k: pp['sl'] * k) for k in (0.5, 0.75, 1, 1.25, 1.5, 2)] + \
          [(f'{k:g}ATR', lambda pp, k=k: pp['atr'] * k) for k in (0.5, 0.75, 1, 1.25, 1.5, 2)]

def run(pp, tgt, mgmt):
    """Return (ticks, contracts) for one trade. mgmt: ('none') | ('be', trigger_fn) | ('trail', dist_fn) | ('scale', c1_tp_fn)
    'scale' = 2 contracts: c1 exits at c1_tp then stop -> breakeven, c2 rides to tgt. Others = 1 contract."""
    sl = pp['sl']; fav = pp['fav']
    if not fav: return 0, 1
    kind = mgmt[0]
    if kind == 'scale':
        c1 = max(1, round(mgmt[1](pp))); tot = 0; out1 = False
        for f in fav:
            if not out1:
                if f <= -sl: return -2 * sl, 2
                if f >= c1: out1 = True; tot += c1
                if not out1: continue
                if f >= tgt: return tot + tgt, 2      # same print can hit both when c1 <= tgt
                continue
            if f >= tgt: return tot + tgt, 2
            if f <= 0: return tot, 2
        return (tot + fav[-1]) if out1 else 2 * fav[-1], 2
    stop = -sl; trig = None
    if kind == 'be': trig = max(1, round(mgmt[1](pp)))
    trail = max(1, round(mgmt[1](pp))) if kind == 'trail' else None
    mfe = 0
    for f in fav:
        if f <= stop: return stop, 1
        if f >= tgt: return tgt, 1
        mfe = max(mfe, f)
        if kind == 'be' and mfe >= trig: stop = max(stop, 0)
        if kind == 'trail' and mfe - trail > stop: stop = mfe - trail
    return fav[-1], 1

MGMT = [('none', ('none',)),
        ('BE @+40t', ('be', lambda pp: 40)), ('BE @+0.5R', ('be', lambda pp: pp['sl'] * 0.5)), ('BE @+1ATR', ('be', lambda pp: pp['atr'])),
        ('trail 60t', ('trail', lambda pp: 60)), ('trail 1ATR', ('trail', lambda pp: pp['atr'])), ('trail 0.5R', ('trail', lambda pp: pp['sl'] * 0.5)),
        ('2ct: c1 40t→BE', ('scale', lambda pp: 40)), ('2ct: c1 0.5ATR→BE', ('scale', lambda pp: pp['atr'] * 0.5)), ('2ct: c1 0.5R→BE', ('scale', lambda pp: pp['sl'] * 0.5))]

rows = []
for tname, tfn in TARGETS:
    for mname, mg in MGMT:
        res = [run(pp, max(1, round(tfn(pp))), mg) for pp in paths]
        n = len(res); w = sum(1 for t, _ in res if t > 0); net = sum(t for t, _ in res)
        R = sum(t / (c * pp['sl']) for (t, c), pp in zip(res, paths)); per_ct = sum(t / c for t, c in res)
        plan = st.mean(max(1, round(tfn(pp))) / pp['sl'] for pp in paths)
        rows.append({'target': tname, 'stop mgmt': mname, 'win%': round(w / n * 100), 'avg R': round(R / n, 3), 'net ticks (1ct-equiv)': round(per_ct), '$/contract': round(per_ct * 5), 'plan R:R': round(plan, 2), 'contracts': res[0][1]})
out = os.path.join(HERE, '..', 'exports', 'tp_grid.csv')
with open(out, 'w', newline='', encoding='utf-8-sig') as f:
    wr = csv.DictWriter(f, fieldnames=list(rows[0].keys())); wr.writeheader(); wr.writerows(rows)
print(f"{len(rows)} combinations x {len(paths)} trades -> {os.path.abspath(out)}\n")
def show(title, sel, n=12):
    print(title); print(f"{'target':>8} | {'stop mgmt':>18} | {'win%':>4} | {'avg R':>6} | {'net t/ct':>8} | plan R:R")
    for r in sel[:n]: print(f"{r['target']:>8} | {r['stop mgmt']:>18} | {r['win%']:>3}% | {r['avg R']:>+6.2f} | {r['net ticks (1ct-equiv)']:>+8} | 1:{r['plan R:R']:.2f}")
    print()
show('TOP by avg R:', sorted(rows, key=lambda r: -r['avg R']))
show('TOP by win rate (avg R > 0.3):', sorted([r for r in rows if r['avg R'] > 0.3], key=lambda r: (-r['win%'], -r['avg R'])))
base = next(r for r in rows if r['target'] == '40t' and r['stop mgmt'] == 'none')
print(f"your original (40t, no mgmt): win {base['win%']}%, avg R {base['avg R']:+.2f}, net {base['net ticks (1ct-equiv)']:+d}t")
print('\nstop-management effect, averaged over all 20 targets (avg R):')
for mname, _ in MGMT:
    sel = [r for r in rows if r['stop mgmt'] == mname]; print(f"  {mname:>18}: avg R {st.mean(r['avg R'] for r in sel):+.3f}   win {st.mean(r['win%'] for r in sel):.0f}%")
