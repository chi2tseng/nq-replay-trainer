"""Bar-by-bar trailing stop on the trade's OWN N-tick bars, original stop, various targets.
Rule (short): after entry, each completed bar: red (close<open) -> stop = bar high + 1 tick (tighten only); green -> no move.
Long mirrored: green bar -> stop = bar low - 1 tick. Entry bar itself is skipped. Exit at stop or target.
Usage: py sim_bartrail.py <bar_ticks> <trades...>"""
import sys, os, json, bisect, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0]
a, b = src.split('# ---- per trade'); exec(a)
orig = {}
for tr in trades: orig[id(tr)] = int(tr['stopTicks']); tr['stopTicks'] = '100000'
exec('# ---- per trade' + b)
_bars = {}
def tick_bars(day):
    if day in _bars: return _bars[day]
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'open': p[i], 'high': p[i], 'low': p[i], 'close': p[i], 'start_i': i, 'end_i': i}; bars.append(cur); acc = 0
        cur['high'] = max(cur['high'], p[i]); cur['low'] = min(cur['low'], p[i]); cur['close'] = p[i]; cur['end_i'] = i; acc += s[i]
    _bars[day] = bars; return bars
def wilder(bars, n=10):
    tr = [bars[0]['high'] - bars[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(bars, bars[1:])]
    a = sum(tr[:n]) / n
    for v in tr[n:]: a = (a * (n - 1) + v) / n
    return a
for pp in paths:
    tr = pp['tr']; pp['sl'] = orig[id(tr)]; ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day)
    px = float(tr['entry']); long = tr['side'] == 'long'; ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    bars = tick_bars(day); pp['atr_bar'] = wilder([bb for bb in bars if bb['end_i'] < i]) / TICK
    fv = lambda price: round(((price - px) if long else (px - price)) / TICK)
    # bars fully after entry: (fav_open, fav_close, fav_worst, end_offset into pp['fav'] (index of last print of that bar))
    pp['bars'] = [(fv(bb['open']), fv(bb['close']), fv(bb['high'] if not long else bb['low']), bb['end_i'] - (i + 1)) for bb in bars if bb['start_i'] > i]
def run(pp, tgt, trail):
    sl = pp['sl']; stop = -sl; fav = pp['fav']; bi = 0; bars = pp['bars']
    for k, f in enumerate(fav):
        if f <= stop: return stop
        if f >= tgt: return tgt
        if trail and bi < len(bars) and k == bars[bi][3]:
            o, c, worst, _ = bars[bi]; bi += 1
            if c > o: stop = max(stop, worst - 1)      # bar closed in our favour -> stop 1 tick beyond its adverse extreme
    return fav[-1] if fav else 0
TGTS = [('50t', lambda pp: 50), ('100t', lambda pp: 100), ('0.5ATR', lambda pp: pp['atr_bar'] * 0.5), ('1ATR', lambda pp: pp['atr_bar']), ('no TP', lambda pp: 10**6)]
print(f"{len(paths)} trades | stop median {st.median(pp['sl'] for pp in paths):.0f}t")
print(f"{'tgt':>7} | {'mgmt':>9} | win | avg R | net t | plan")
for tn, tfn in TGTS:
    for mn, trail in (('none', False), ('bar trail', True)):
        res = [run(pp, max(1, round(tfn(pp))), trail) for pp in paths]; n = len(res); w = sum(1 for t in res if t > 0)
        R = sum(t / pp['sl'] for t, pp in zip(res, paths)); plan = st.mean(min(tfn(pp), 10**6) / pp['sl'] for pp in paths)
        print(f"{tn:>7} | {mn:>9} | {w/n*100:3.0f}% | {R/n:+.2f} | {sum(res):+6d} | " + ('—' if tn == 'no TP' else f'1:{plan:.2f}'))
