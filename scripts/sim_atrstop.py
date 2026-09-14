"""Stop = k x ATR(10) of the trade's OWN N-tick bars (last completed bar before entry); targets fixed / R / ATR.
Usage: py sim_atrstop.py <bar_ticks> <trades...>"""
import sys, os, json, bisect, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); sys.argv = [sys.argv[0]] + sys.argv[2:]
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0]
a, b = src.split('# ---- per trade'); exec(a)
for tr in trades: tr['stopTicks'] = '100000'          # never truncate: we apply the stop ourselves
exec('# ---- per trade' + b)
_bars = {}
def tick_bars(day):
    if day in _bars: return _bars[day]
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'high': p[i], 'low': p[i], 'close': p[i], 'end_i': i}; bars.append(cur); acc = 0
        cur['high'] = max(cur['high'], p[i]); cur['low'] = min(cur['low'], p[i]); cur['close'] = p[i]; cur['end_i'] = i; acc += s[i]
    _bars[day] = bars; return bars
def wilder(bars, n=10):
    tr = [bars[0]['high'] - bars[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(bars, bars[1:])]
    a = sum(tr[:n]) / n
    for v in tr[n:]: a = (a * (n - 1) + v) / n
    return a
for pp in paths:
    tr = pp['tr']; ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day)
    i = bisect.bisect_left(ms, int(ent.timestamp() * 1000)); pp['atr_bar'] = wilder([b for b in tick_bars(day) if b['end_i'] < i]) / TICK
    pp['orig_sl'] = int(tr.get('_orig_sl') or 0)
def run(pp, sl, tgt):
    for f in pp['fav']:
        if f <= -sl: return -sl
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0
STOPS = [(f'{k:g}xATR', lambda pp, k=k: pp['atr_bar'] * k) for k in (0.5, 0.75, 1, 1.25, 1.5)]
TGTS = [(f'{t}t', lambda pp, sl, t=t: t) for t in (40, 50, 60, 100, 110)] + [(f'{k:g}R', lambda pp, sl, k=k: sl * k) for k in (0.5, 1)] + [(f'{k:g}ATR', lambda pp, sl, k=k: pp['atr_bar'] * k) for k in (0.5, 1)]
print(f'{len(paths)} trades | ATR{BAR}t median {st.median(pp["atr_bar"] for pp in paths):.0f}t')
print(f"{'stop':>8} | {'tgt':>6} | win | avg R | net t | plan")
for sn, sfn in STOPS:
    for tn, tfn in TGTS:
        res = []; plan = []
        for pp in paths:
            sl = max(1, round(sfn(pp))); tgt = max(1, round(tfn(pp, sl))); res.append((run(pp, sl, tgt), sl)); plan.append(tgt / sl)
        n = len(res); w = sum(1 for t, _ in res if t > 0); R = sum(t / s for t, s in res); net = sum(t for t, _ in res)
        print(f'{sn:>8} | {tn:>6} | {w/n*100:3.0f}% | {R/n:+.2f} | {net:+6d} | 1:{st.mean(plan):.2f}')
    print()
