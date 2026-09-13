"""ATR(10) computed on the trade's OWN tick-bar timeframe (N-tick bars, contract-count like the app), then
target = k x that ATR, original stop, 1 contract. Usage: py sim_atr_ownbar.py <bar_ticks> <trades...>"""
import sys, os, json, bisect, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])
_bars = {}
def tick_bars(day):
    if day in _bars: return _bars[day]
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']; t0 = d['t0']; dt = d['dt']
    bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'i0': i, 'high': p[i], 'low': p[i], 'close': p[i], 'end_i': i}; bars.append(cur); acc = 0
        if p[i] > cur['high']: cur['high'] = p[i]
        if p[i] < cur['low']: cur['low'] = p[i]
        cur['close'] = p[i]; cur['end_i'] = i; acc += s[i]
    _bars[day] = bars; return bars
def atr_bars(bars, upto_i, n=10):   # Wilder ATR over completed bars ending before print index upto_i
    done = [b for b in bars if b['end_i'] < upto_i]
    tr = [done[0]['high'] - done[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(done, done[1:])]
    a = sum(tr[:n]) / n
    for x in tr[n:]: a = (a * (n - 1) + x) / n
    return a
for pp in paths:
    tr = pp['tr']; ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day)
    i = bisect.bisect_left(ms, int(ent.timestamp() * 1000)); pp['atr_bar'] = atr_bars(tick_bars(day), i) / TICK
def one(pp, tgt):
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
print(f"{len(paths)} trades | ATR(10) on {BAR}t bars at entry: median {st.median(pp['atr_bar'] for pp in paths):.0f}t (1m ATR median {st.median(pp['atr'] for pp in paths):.0f}t) | stop median {st.median(pp['sl'] for pp in paths):.0f}t")
print(f"{'target':>14} | {'win%':>4} | {'avg R':>6} | {'net t':>6} | plan R:R")
for k in (0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3):
    res = [(one(pp, max(1, round(k * pp['atr_bar']))), pp['sl']) for pp in paths]; n = len(res); w = sum(1 for t, _ in res if t > 0); R = sum(t / s for t, s in res)
    plan = st.mean(max(1, round(k * pp['atr_bar'])) / pp['sl'] for pp in paths)
    print(f"{k:>5g} x ATR{BAR}t | {w/n*100:3.0f}% | {R/n:>+6.2f} | {sum(t for t,_ in res):>+6d} | 1:{plan:.2f}")
res = [(one(pp, 40), pp['sl']) for pp in paths]; print(f"{'40t fixed':>14} | {sum(1 for t,_ in res if t>0)/len(res)*100:3.0f}% | {sum(t/s for t,s in res)/len(res):>+6.2f} | {sum(t for t,_ in res):>+6d} |")
