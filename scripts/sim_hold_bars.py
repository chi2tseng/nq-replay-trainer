"""Holding time in 2000-tick bars (contract-count bars, like the app) per trade for several targets. Usage: py sim_hold_bars.py <trades...>"""
import sys, os, bisect, json, statistics as st, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('# ---- per trade')[0])
BAR = 2000; TARGETS = [40, 60, 110]
_bar_idx = {}
def bar_index(day):   # print index -> 2000t bar index, built from the session open like the app
    if day in _bar_idx: return _bar_idx[day]
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); s = d['s']; idx = [0] * len(s); b = 0; acc = 0
    for i in range(len(s)):
        if acc >= BAR: b += 1; acc = 0
        idx[i] = b; acc += s[i]
    _bar_idx[day] = idx; return idx
rows = []
for tr in trades:
    ent = parse_et(tr['entryTime']); px = float(tr['entry']); long = tr['side'] == 'long'; sl = int(tr['stopTicks']); day = trading_day(ent)
    name, ms, p = tape('NQ', day); bi = bar_index(day); ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    atr_t = atr_at(minute_bars(ms, p), ems) / TICK
    def walk(tgt):
        for k in range(i + 1, len(p)):
            f = round(((p[k] - px) if long else (px - p[k])) / TICK)
            if f <= -sl: return 'L', bi[k] - bi[i]
            if f >= tgt: return 'W', bi[k] - bi[i]
        return '-', bi[-1] - bi[i]
    r = {'when': ent.strftime('%m/%d %H:%M'), 'side': tr['side'][0].upper()}
    for t in TARGETS: r[t] = walk(t)
    r['atr'] = walk(max(1, round(atr_t))); rows.append(r)
print(f"{'entry':>12} {'S':1} | " + ' | '.join(f"{str(t)+'t':>7}" for t in TARGETS) + f" | {'1xATR':>7}   (bars after the entry bar; 0 = same bar)")
for r in rows: print(f"{r['when']:>12} {r['side']} | " + ' | '.join(f"{r[t][0]} {r[t][1]:>4}" for t in TARGETS) + f" | {r['atr'][0]} {r['atr'][1]:>4}")
print('\nsummary:')
print(f"{'target':>8} | {'median':>6} | {'mean':>5} | {'max':>4} | same bar | <=1 bar | <=3 bars | >5 bars")
for key, lab in [(40, '40t'), (60, '60t'), (110, '110t'), ('atr', '1xATR')]:
    hs = [r[key][1] for r in rows]
    print(f"{lab:>8} | {st.median(hs):>6.1f} | {st.mean(hs):>5.1f} | {max(hs):>4} | {sum(1 for h in hs if h == 0):>8} | {sum(1 for h in hs if h <= 1):>7} | {sum(1 for h in hs if h <= 3):>8} | {sum(1 for h in hs if h > 5):>7}")
