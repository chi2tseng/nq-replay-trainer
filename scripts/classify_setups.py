"""Objective setup features on the trade's own N-tick bars, then a simple classification.
Usage: py classify_setups.py <bar_ticks> <label> <trades.csv> [more label csv pairs...]"""
import sys, os, json, bisect, datetime, statistics as st
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); pairs = list(zip(sys.argv[2::2], sys.argv[3::2]))
sys.argv = [sys.argv[0], pairs[0][1]]
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('# ---- per trade')[0]; exec(src)
cache = {}
def tick_bars(day):
    if day in cache: return cache[day]
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']; t0, dt = d['t0'], d['dt']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'o': p[i], 'h': p[i], 'l': p[i], 'c': p[i], 'si': i, 'ei': i, 't': t0 + dt[i]}; bars.append(cur); acc = 0
        cur['h'] = max(cur['h'], p[i]); cur['l'] = min(cur['l'], p[i]); cur['c'] = p[i]; cur['ei'] = i; acc += s[i]
    cache[day] = bars; return bars
def feats(tr):
    ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day); bars = tick_bars(day)
    px = float(tr['entry']); long = tr['side'] == 'long'; sg = 1 if long else -1
    i = bisect.bisect_left(ms, int(ent.timestamp() * 1000)); j = i
    while j < len(p) and ms[j] < ms[i] + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    ei = next(k for k, b in enumerate(bars) if b['ei'] >= i); pre = bars[max(0, ei - 20):ei]; last10 = pre[-10:]
    trend = sg * (pre[-1]['c'] - pre[0]['c']) / TICK                                   # 20-bar net move, + = with trade
    ext = max(b['h'] for b in last10) if long else min(b['l'] for b in last10)         # 10-bar extreme in trade direction
    pull = sg * (ext - pre[-1]['c']) / TICK                                             # how far price pulled back from that extreme
    brk = sg * (px - ext) / TICK                                                        # entry beyond the 10-bar extreme?
    cols = ''.join('u' if b['c'] >= b['o'] else 'd' for b in pre[-5:]); mine = 'u' if long else 'd'
    run = 0
    for ch in reversed(cols):
        if ch == mine: run += 1
        else: break
    against = 0
    for ch in reversed(cols):
        if ch != mine: against += 1
        else: break
    mins = (ent.hour - 9) * 60 + ent.minute - 30
    sess = [b for b in bars if datetime.datetime.fromtimestamp(b['t'] / 1000, ET).hour >= 9 and datetime.datetime.fromtimestamp(b['t'] / 1000, ET).strftime('%H:%M') >= '09:30' and b['ei'] < i]
    if sess: shi, slo = max(b['h'] for b in sess), min(b['l'] for b in sess); pos = (px - slo) / max(shi - slo, TICK)
    else: pos = 0.5
    pnl = float(tr['pnl'])
    return dict(t=tr['entryTime'][:11], side=tr['side'][0].upper(), win=pnl > 0, trend=round(trend), pull=round(pull), brk=round(brk), run=run, against=against, cols=cols, mins=mins, pos=round(pos, 2), sl=int(tr['stopTicks']))
def cls(f):
    if f['trend'] < -40: return '逆勢'
    if f['brk'] >= 0: return '順勢突破'
    if f['pull'] >= 40: return '順勢回調'
    return '順勢延續'
allrows = []
for label, fn in pairs:
    rows = trades_from_csv(fn); print(f'\n== {label} ({len(rows)})'); print(f"{'entry':>12} | S | W | trend20 | pull | brk | run/ag | last5 | min | pos | class")
    for tr in rows:
        f = feats(tr); f['cls'] = cls(f); f['grp'] = label; allrows.append(f)
        print(f"{f['t']:>12} | {f['side']} | {'W' if f['win'] else 'L'} | {f['trend']:>+7} | {f['pull']:>4} | {f['brk']:>+3} | {f['run']}/{f['against']}    | {f['cols']} | {f['mins']:>3} | {f['pos']:.2f} | {f['cls']}")
print('\n== by class x group')
for c in ('順勢回調', '順勢延續', '順勢突破', '逆勢'):
    for label, _ in pairs:
        s = [f for f in allrows if f['cls'] == c and f['grp'] == label]
        if s: print(f"{c:>6} | {label:>6} | n={len(s):>2} | win {sum(f['win'] for f in s)/len(s)*100:3.0f}%")
print('\n== by time bucket (min after 9:30)')
for lo, hi in ((-999, 0), (0, 30), (30, 60), (60, 90), (90, 999)):
    for label, _ in pairs:
        s = [f for f in allrows if lo <= f['mins'] < hi and f['grp'] == label]
        if s: print(f"{lo:>4}..{hi:<4} | {label:>6} | n={len(s):>2} | win {sum(f['win'] for f in s)/len(s)*100:3.0f}%")
