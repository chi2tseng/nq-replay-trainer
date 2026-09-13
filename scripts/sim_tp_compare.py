"""Take-profit comparison over a set of real trades (same entry price/time, ORIGINAL per-trade stop),
replayed on the tick tape. Three target families + two 2-contract management plans.

Usage: py sim_tp_compare.py <trades.csv|.json> [more files...]
  CSV = the app's Export CSV; JSON = a raw rt_trades dump. Duplicates (same entryTime) are merged.
"""
import sys, os, json, bisect, datetime, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
files = [a for a in sys.argv[1:] if not a.startswith('--')]
code = open(os.path.join(HERE, 'sim_bracket.py'), encoding='utf-8').read().split('rows = trades_from_json')[0]
sys.argv = [sys.argv[0], files[0], '40', '40']; exec(code)        # loaders, tape(), parse_et(), trading_day(), TICK, ET

# ---- collect trades (dedupe on entry time) ----
seen = {};
for f in files:
    rows = trades_from_json(f) if f.lower().endswith('.json') else trades_from_csv(f)
    for tr in rows:
        key = int(parse_et(tr['entryTime']).timestamp()); tr['_t'] = key
        if key not in seen and tr.get('stopTicks'): seen[key] = tr
trades = [seen[k] for k in sorted(seen)]
print(f"{len(trades)} unique trades from {len(files)} file(s): {parse_et(trades[0]['entryTime']):%m/%d} .. {parse_et(trades[-1]['entryTime']):%m/%d}, stops {min(int(t['stopTicks']) for t in trades)}..{max(int(t['stopTicks']) for t in trades)}t (avg {st.mean(int(t['stopTicks']) for t in trades):.0f}t)\n")

def minute_bars(ms, p, span=60000):
    bars = []; cur = None
    for t, v in zip(ms, p):
        b = t // span
        if cur is None or cur['b'] != b: cur = {'b': b, 'high': v, 'low': v, 'close': v, 'end': (b + 1) * span}; bars.append(cur)
        cur['high'] = max(cur['high'], v); cur['low'] = min(cur['low'], v); cur['close'] = v
    return bars
def atr_at(bars, upto, n=10):
    done = [b for b in bars if b['end'] <= upto]
    tr = [done[0]['high'] - done[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(done, done[1:])]
    a = sum(tr[:n]) / n
    for x in tr[n:]: a = (a * (n - 1) + x) / n
    return a

# ---- per trade: the favourable-excursion path in ticks (until the ORIGINAL stop is hit) ----
paths = []
for tr in trades:
    ent = parse_et(tr['entryTime']); px = float(tr['entry']); long = tr['side'] == 'long'; sl = int(tr['stopTicks'])
    tp_ = tape(tr.get('sym') or 'NQ', trading_day(ent))
    if not tp_: print('  no tape for', tr['entryTime']); continue
    name, ms, p = tp_; ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    fav = []   # signed favourable ticks per print after entry, until stop
    for k in range(i + 1, len(p)):
        f = round(((p[k] - px) if long else (px - p[k])) / TICK); fav.append(f)
        if f <= -sl: break
    atr_t = atr_at(minute_bars(ms, p), ems) / TICK
    paths.append({'tr': tr, 'sl': sl, 'fav': fav, 'atr': atr_t, 'mfe': max(fav) if fav else 0, 'stopped': bool(fav) and fav[-1] <= -sl})

def one_contract(path, tgt):   # ticks result for a single contract with target tgt and the original stop
    sl = path['sl']
    for f in path['fav']:
        if f <= -sl: return -sl
        if f >= tgt: return tgt
    return path['fav'][-1] if path['fav'] else 0

def scale_out(path, tp1, tp2):   # 2 contracts: c1 exits at tp1; then stop -> breakeven; c2 exits at tp2 / BE / original stop
    sl = path['sl']; c1 = None; total = 0
    for f in path['fav']:
        if c1 is None:
            if f <= -sl: return -2 * sl
            if f >= tp1: c1 = tp1; total += tp1; continue
        else:
            if f >= tp2: return total + tp2
            if f <= 0: return total + 0
    return total + (path['fav'][-1] if path['fav'] else 0) if c1 is not None else 2 * (path['fav'][-1] if path['fav'] else 0)

def line(label, results, risk_per):   # results: list of (ticks, risk)
    n = len(results); w = sum(1 for t, _ in results if t > 0); net = sum(t for t, _ in results); R = sum(t / r for t, r in results)
    plan = st.mean(risk_per)
    return f"{label:>22} | {w/n*100:4.0f}% | {net:>+6d}t | {net*5:>+8,.0f} | {R/n:>+6.2f} | 1:{plan:.2f}"

hdr = f"{'target':>22} | {'win%':>4} | {'net':>7} | {'$/ct':>8} | {'avg R':>6} | plan R:R"
print("== ONE CONTRACT, stop = original ==\n" + hdr)
def fam(label, fn):
    res = [(one_contract(pp, max(1, round(fn(pp)))), pp['sl']) for pp in paths]
    print(line(label, res, [max(1, round(fn(pp))) / pp['sl'] for pp in paths]))
print('-- fixed ticks')
for t in (40, 50, 60, 80, 100, 120, 160, 200): fam(f'{t} tick', lambda pp, t=t: t)
print('-- R multiple')
for k in (0.5, 0.75, 1, 1.25, 1.5, 2): fam(f'{k:g} R', lambda pp, k=k: pp['sl'] * k)
print('-- ATR(10) multiple')
for k in (0.5, 0.75, 1, 1.25, 1.5, 2): fam(f'{k:g} ATR10', lambda pp, k=k: pp['atr'] * k)

print("\n== TWO CONTRACTS, stop = original (risk = 2 x stop) ==")
print(f"{'plan':>34} | {'win%':>4} | {'net':>7} | {'$/trade':>8} | {'avg R':>6}")
def two(label, fn):
    res = [(fn(pp), 2 * pp['sl']) for pp in paths]
    n = len(res); w = sum(1 for t, _ in res if t > 0); net = sum(t for t, _ in res); R = sum(t / r for t, r in res)
    print(f"{label:>34} | {w/n*100:4.0f}% | {net:>+6d}t | {net*5:>+8,.0f} | {R/n:>+6.2f}")
two('both TP 40 (original x2)', lambda pp: 2 * one_contract(pp, 40))
two('c1 TP40, c2 TP80, BE after +40', lambda pp: scale_out(pp, 40, 80))
two('c1 TP40, c2 TP120, BE after +40', lambda pp: scale_out(pp, 40, 120))
two('c1 TP40, c2 1.25ATR, BE after +40', lambda pp: scale_out(pp, 40, max(41, round(pp['atr'] * 1.25))))
two('both TP 80', lambda pp: 2 * one_contract(pp, 80))
two('both TP 1.25 ATR10', lambda pp: 2 * one_contract(pp, max(1, round(pp['atr'] * 1.25))))
print("\nper-trade MFE before stop (ticks):", [pp['mfe'] for pp in paths])
