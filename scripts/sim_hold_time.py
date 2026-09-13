"""Holding time per trade for a few targets (original stop). Usage: py sim_hold_time.py <trades...>"""
import sys, os, bisect, statistics as st, datetime
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('# ---- per trade')[0])
TARGETS = [40, 60, 110]
rows = []
for tr in trades:
    ent = parse_et(tr['entryTime']); px = float(tr['entry']); long = tr['side'] == 'long'; sl = int(tr['stopTicks'])
    name, ms, p = tape('NQ', trading_day(ent)); ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    t_entry = ms[i]; atr_t = atr_at(minute_bars(ms, p), ems) / TICK
    def walk(tgt):
        for k in range(i + 1, len(p)):
            f = round(((p[k] - px) if long else (px - p[k])) / TICK)
            if f <= -sl: return 'L', (ms[k] - t_entry) / 60000
            if f >= tgt: return 'W', (ms[k] - t_entry) / 60000
        return '-', (ms[-1] - t_entry) / 60000
    r = {'when': ent.strftime('%m/%d %H:%M'), 'side': tr['side'][0].upper(), 'sl': sl}
    for t in TARGETS: r[t] = walk(t)
    r['atr'] = walk(max(1, round(atr_t)))
    rows.append(r)
def fmt(m): return f"{m:5.1f}m" if m < 60 else f"{m/60:4.1f}h"
print(f"{'entry':>12} {'S':1} {'stop':>4} | " + ' | '.join(f"{str(t)+'t':>9}" for t in TARGETS) + f" | {'1xATR':>9}")
for r in rows: print(f"{r['when']:>12} {r['side']} {r['sl']:>3}t | " + ' | '.join(f"{r[t][0]} {fmt(r[t][1]):>7}" for t in TARGETS) + f" | {r['atr'][0]} {fmt(r['atr'][1]):>7}")
print('\nsummary (all trades):')
print(f"{'target':>8} | {'median':>7} | {'mean':>7} | {'max':>7} | {'wins median':>11} | {'losses median':>13} | over 1h")
for key, lab in [(40, '40t'), (60, '60t'), (110, '110t'), ('atr', '1xATR')]:
    hs = [r[key][1] for r in rows]; ws = [r[key][1] for r in rows if r[key][0] == 'W']; ls = [r[key][1] for r in rows if r[key][0] == 'L']
    print(f"{lab:>8} | {fmt(st.median(hs)):>7} | {fmt(st.mean(hs)):>7} | {fmt(max(hs)):>7} | {fmt(st.median(ws)) if ws else '-':>11} | {fmt(st.median(ls)) if ls else '-':>13} | {sum(1 for h in hs if h > 60)}")
