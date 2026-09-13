"""What-if: ATR-sized brackets. For each trade, ATR(10, Wilder — same formula as the app's oscillator) is taken
from the 1-minute bars of that session up to the last COMPLETED bar before entry; stop = s × ATR,
target = m × ATR (rounded to ticks), then replayed on the real tick tape from the same entry.

Usage: py sim_atr.py <trades.json|replay_trades.csv> [atrLen=10] [tf_minutes=1]
"""
import sys, os, json, math, bisect, datetime
sys.argv = [sys.argv[0]] + sys.argv[1:]   # keep
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
src, ATR_LEN, TF = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 10, float(sys.argv[3]) if len(sys.argv) > 3 else 1.0
# reuse the loaders / tape access from sim_bracket without running its main block
code = open(os.path.join(HERE, 'sim_bracket.py'), encoding='utf-8').read().split('rows = trades_from_json')[0]
sys.argv = [sys.argv[0], src, '40', '40']; exec(code)

def minute_bars(ms, p, tf_min):
    span = int(tf_min * 60000); bars = []; cur = None
    for t, v in zip(ms, p):
        b = t // span
        if cur is None or cur['b'] != b:
            cur = {'b': b, 'high': v, 'low': v, 'close': v, 'end': (b + 1) * span}; bars.append(cur)
        cur['high'] = max(cur['high'], v); cur['low'] = min(cur['low'], v); cur['close'] = v
    return bars

def atr_at(bars, upto_ms, n):   # Wilder ATR over completed bars whose end <= upto_ms
    done = [b for b in bars if b['end'] <= upto_ms]
    if len(done) < n + 1: return None
    tr = [done[0]['high'] - done[0]['low']] + [max(b['high'] - b['low'], abs(b['high'] - a['close']), abs(b['low'] - a['close'])) for a, b in zip(done, done[1:])]
    a = sum(tr[:n]) / n
    for x in tr[n:]: a = (a * (n - 1) + x) / n
    return a

def run(tr, sl_t, tp_t):
    ent = parse_et(tr['entryTime']); px = float(tr['entry']); long = tr['side'] == 'long'
    name, ms, p = tape(tr.get('sym') or 'NQ', trading_day(ent))
    ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    stop = px - sl_t * TICK if long else px + sl_t * TICK; tgt = px + tp_t * TICK if long else px - tp_t * TICK
    for k in range(i + 1, len(p)):
        v = p[k]
        if (v <= stop) if long else (v >= stop): return -sl_t
        if (v >= tgt) if long else (v <= tgt): return tp_t
    return round((p[-1] - px) / TICK) * (1 if long else -1)

rows = trades_from_json(src) if src.lower().endswith('.json') else trades_from_csv(src)
atrs = []
print(f"ATR({ATR_LEN}) on {TF:g}m bars at entry:")
for tr in rows:
    ent = parse_et(tr['entryTime']); name, ms, p = tape(tr.get('sym') or 'NQ', trading_day(ent))
    a = atr_at(minute_bars(ms, p, TF), int(ent.timestamp() * 1000), ATR_LEN); atrs.append(a)
    print(f"  #{tr['idx']:>2} {tr['side']:5} {ent:%m/%d %H:%M:%S}  ATR {a:6.2f} pts = {a / TICK:5.0f} ticks   (your stop was {tr.get('stopTicks')}t)")
print(f"\n{'stop':>8} {'target':>8} {'RR':>4} | {'W':>2} {'L':>2} {'win%':>5} {'net ticks':>10} {'$ / contract':>12} {'expect t/trade':>15}")
for s_mult in (0.5, 1.0, 1.5, 2.0):
    for rr in (1, 2, 3):
        w = l = 0; net = 0
        for tr, a in zip(rows, atrs):
            sl_t = max(1, round(s_mult * a / TICK)); tp_t = max(1, round(rr * sl_t))
            r = run(tr, sl_t, tp_t); net += r
            if r > 0: w += 1
            elif r < 0: l += 1
        print(f"{s_mult:>5g}ATR {rr * s_mult:>5g}ATR {f'1:{rr}':>4} | {w:>2} {l:>2} {w / (w + l) * 100 if w + l else 0:>4.0f}% {net:>+10d} {net * 5:>+12.0f} {net / len(rows):>+15.1f}")
