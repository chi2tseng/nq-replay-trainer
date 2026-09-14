"""Losses: stop-run or wrong direction? MAE before TP, and effect of adding a buffer to the structural stop.
Usage: py sim_stopbuffer.py <bar_ticks> <tp_ticks> <trades...>"""
import sys, os, json, bisect, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); TP = _TP = int(sys.argv[2]); sys.argv = [sys.argv[0]] + sys.argv[3:]
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0]
a, b = src.split('# ---- per trade'); exec(a)
orig = {}
for tr in trades: orig[id(tr)] = int(tr['stopTicks']); tr['stopTicks'] = '100000'
exec('# ---- per trade' + b); TP = _TP
def tick_bars(day):
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'high': p[i], 'low': p[i], 'close': p[i], 'end_i': i}; bars.append(cur); acc = 0
        cur['high'] = max(cur['high'], p[i]); cur['low'] = min(cur['low'], p[i]); cur['close'] = p[i]; cur['end_i'] = i; acc += s[i]
    return bars
def wilder(bars, n=10):
    tr = [bars[0]['high'] - bars[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(bars, bars[1:])]
    a = sum(tr[:n]) / n
    for v in tr[n:]: a = (a * (n - 1) + v) / n
    return a
cache = {}
for pp in paths:
    tr = pp['tr']; pp['sl'] = orig[id(tr)]; ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day)
    if day not in cache: cache[day] = tick_bars(day)
    i = bisect.bisect_left(ms, int(ent.timestamp() * 1000)); pp['atr'] = wilder([bb for bb in cache[day] if bb['end_i'] < i]) / TICK
    mae = 0; hit = None
    for k, f in enumerate(pp['fav']):
        if f >= TP: hit = k; break
        mae = min(mae, f)
    pp['mae_before_tp'] = -mae if hit is not None else None   # ticks of adverse move endured before TP would print (None = TP never hit that day)
    pp['lost'] = any(f <= -pp['sl'] for f in pp['fav'][:hit] if True) if hit is not None else True
def run(pp, sl, tgt):
    for f in pp['fav']:
        if f <= -sl: return -sl
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
print(f"{len(paths)} trades, TP {TP}t\n")
print("LOSSES with original stop — how far the stop needed to be to survive until TP:")
for pp in paths:
    if run(pp, pp['sl'], TP) <= 0:
        m = pp['mae_before_tp']; print(f"  {pp['tr']['entryTime']} {pp['tr']['side']:>5}  stop {pp['sl']:>3}t  MAE-before-TP {'never hit TP' if m is None else f'{m}t  (needed +{m - pp['sl']}t more)'}  ATR {pp['atr']:.0f}t")
ws = [pp['mae_before_tp'] for pp in paths if run(pp, pp['sl'], TP) > 0]
print(f"\nWINNERS: MAE before TP median {st.median(ws):.0f}t, max {max(ws)}t, as %% of stop median {st.median(pp['mae_before_tp'] / pp['sl'] for pp in paths if run(pp, pp['sl'], TP) > 0) * 100:.0f}%\n")
print(f"{'stop rule':>22} | win | avg R | net t | plan R:R")
rules = [('struct (orig)', lambda pp: pp['sl'])] + [(f'struct +{b}t', lambda pp, b=b: pp['sl'] + b) for b in (10, 20, 30, 40)] + \
        [(f'max(struct, {k}ATR)', lambda pp, k=k: max(pp['sl'], pp['atr'] * k)) for k in (0.75, 1, 1.25)] + [(f'struct x{k}', lambda pp, k=k: pp['sl'] * k) for k in (1.2, 1.5)]
for name, fn in rules:
    res = [(run(pp, max(1, round(fn(pp))), TP), max(1, round(fn(pp)))) for pp in paths]; n = len(res); w = sum(1 for t, _ in res if t > 0)
    print(f"{name:>22} | {w/n*100:3.0f}% | {sum(t/s for t, s in res)/n:+.2f} | {sum(t for t, _ in res):+5d} | 1:{st.mean(TP/s for _, s in res):.2f}")
