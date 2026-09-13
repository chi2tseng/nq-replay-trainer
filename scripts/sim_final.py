"""Consolidated, self-checked target comparison for one trade set.
ATR = ATR(10) on the trade's OWN N-tick bars, exactly as the app's oscillator computes it (verified bar-for-bar
against the app on 2026-09-11), read from the last COMPLETED bar before entry. Stop = original per-trade stop.
Usage: py sim_final.py <bar_ticks> <trades...>   e.g. py sim_final.py 2000 a.csv b.json
"""
import sys, os, json, bisect, statistics as st, csv
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])   # trades, paths(fav, sl, tr)

_bars = {}
def tick_bars(day):
    if day in _bars: return _bars[day]
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'high': p[i], 'low': p[i], 'close': p[i], 'end_i': i}; bars.append(cur); acc = 0
        if p[i] > cur['high']: cur['high'] = p[i]
        if p[i] < cur['low']: cur['low'] = p[i]
        cur['close'] = p[i]; cur['end_i'] = i; acc += s[i]
    _bars[day] = bars; return bars
def wilder(bars, n=10):
    tr = [bars[0]['high'] - bars[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(bars, bars[1:])]
    a = sum(tr[:n]) / n
    for v in tr[n:]: a = (a * (n - 1) + v) / n
    return a
for pp in paths:
    tr = pp['tr']; ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day)
    i = bisect.bisect_left(ms, int(ent.timestamp() * 1000)); bars = tick_bars(day)
    pp['atr_bar'] = wilder([b for b in bars if b['end_i'] < i]) / TICK        # last completed bar before entry, in ticks

# ---------- outcome engines ----------
def run(pp, tgt, mgmt=('none',)):
    """ticks for 1 contract (or total for 2 with 'scale'); returns (ticks, contracts)"""
    sl = pp['sl']; fav = pp['fav']; kind = mgmt[0]
    if not fav: return 0, 1
    if kind == 'scale':
        c1 = max(1, round(mgmt[1](pp))); tot = 0; out1 = False
        for f in fav:
            if not out1:
                if f <= -sl: return -2 * sl, 2
                if f >= c1: out1 = True; tot += c1
                if not out1: continue
                if f >= tgt: return tot + tgt, 2
                continue
            if f >= tgt: return tot + tgt, 2
            if f <= 0: return tot, 2
        return (tot + fav[-1]) if out1 else 2 * fav[-1], 2
    stop = -sl; trig = max(1, round(mgmt[1](pp))) if kind == 'be' else None; trail = max(1, round(mgmt[1](pp))) if kind == 'trail' else None; mfe = 0
    for f in fav:
        if f <= stop: return stop, 1
        if f >= tgt: return tgt, 1
        mfe = max(mfe, f)
        if kind == 'be' and mfe >= trig: stop = max(stop, 0)
        if kind == 'trail' and mfe - trail > stop: stop = mfe - trail
    return fav[-1], 1

rn = lambda x, step: max(step, int(round(x / step)) * step)
TARGETS = [(f'fixed {t}t', lambda pp, t=t: t) for t in (40, 50, 60, 70, 80, 90, 100, 110, 120, 160, 200)] + \
          [(f'{k:g} R', lambda pp, k=k: pp['sl'] * k) for k in (0.5, 0.75, 1, 1.25, 1.5, 2)] + \
          [(f'{k:g} ATR', lambda pp, k=k: pp['atr_bar'] * k) for k in (0.5, 0.75, 1, 1.25, 1.5, 2)] + \
          [(f'{k:g} ATR ~5pt', lambda pp, k=k: rn(pp['atr_bar'] * k, 20)) for k in (0.75, 1)] + \
          [(f'{k:g} ATR ~2.5pt', lambda pp, k=k: rn(pp['atr_bar'] * k, 10)) for k in (0.75, 1)]
MGMT = [('none', ('none',)), ('BE @+1ATR', ('be', lambda pp: pp['atr_bar'])), ('trail 1ATR', ('trail', lambda pp: pp['atr_bar'])), ('2ct c1 0.5ATR→BE', ('scale', lambda pp: pp['atr_bar'] * 0.5))]

rows = []
for tname, tfn in TARGETS:
    for mname, mg in MGMT:
        res = [run(pp, max(1, round(tfn(pp))), mg) for pp in paths]; n = len(res)
        w = sum(1 for t, _ in res if t > 0); R = sum(t / (c * pp['sl']) for (t, c), pp in zip(res, paths)); net = sum(t / c for t, c in res)
        plan = st.mean(max(1, round(tfn(pp))) / pp['sl'] for pp in paths)
        rows.append({'target': tname, 'mgmt': mname, 'win%': round(w / n * 100), 'avgR': round(R / n, 3), 'net_t_per_ct': round(net), 'planRR': round(plan, 2)})
out = os.path.join(HERE, '..', 'exports', f'final_compare_{BAR}t.csv')
with open(out, 'w', newline='', encoding='utf-8-sig') as f: wr = csv.DictWriter(f, fieldnames=list(rows[0])); wr.writeheader(); wr.writerows(rows)

# ---------- self-checks ----------
print(f"SET: {BAR}t bars, {len(paths)} trades | ATR{BAR}t at entry median {st.median(pp['atr_bar'] for pp in paths):.0f}t | stop median {st.median(pp['sl'] for pp in paths):.0f}t")
chk = []
for pp in paths:
    tr = pp['tr']; actual = float(tr['pnl']) > 0; tp_used = int(tr.get('tpTicks') or tr.get('planTp') or 0) if str(tr.get('tpTicks', '')).strip() else None
    if tp_used: sim = run(pp, tp_used)[0] > 0; chk.append(sim == actual)
print(f"self-check: simulated outcome at the ORIGINAL target matches the recorded outcome on {sum(chk)}/{len(chk)} trades (mismatch = fill/timing difference)")
def show(title, sel, n=10):
    print(f"\n{title}\n{'target':>14} | {'mgmt':>18} | {'win%':>4} | {'avg R':>6} | {'net t/ct':>8} | plan R:R")
    for r in sel[:n]: print(f"{r['target']:>14} | {r['mgmt']:>18} | {r['win%']:>3}% | {r['avgR']:>+6.2f} | {r['net_t_per_ct']:>+8} | 1:{r['planRR']:.2f}")
base = next(r for r in rows if r['target'] == 'fixed 40t' and r['mgmt'] == 'none')
print(f"baseline fixed 40t / no mgmt: win {base['win%']}%, avg R {base['avgR']:+.2f}, plan 1:{base['planRR']:.2f}")
show('no stop management — every target rule:', [r for r in rows if r['mgmt'] == 'none'], 40)
show('TOP 10 overall by avg R:', sorted(rows, key=lambda r: -r['avgR']))
show('TOP 10 with win% >= baseline-8:', sorted([r for r in rows if r['win%'] >= base['win%'] - 8], key=lambda r: -r['avgR']))
print(f"\ncsv -> {os.path.abspath(out)}")
