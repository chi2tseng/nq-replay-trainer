"""What-if: replay every trade in a replay_trades CSV with a FIXED stop / target bracket from the same
entry (price + time) on the real tick tape, and report the win rate that bracket would have produced.

Usage: py sim_bracket.py "<replay_trades.csv>" [stopTicks=40] [tpTicks=40] [--nt]
  --nt  prefer the NinjaTrader tape (<SYM>_<day>.nt.json) over Databento when both exist
"""
import sys, csv, json, os, datetime
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); TICK = 0.25
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'tick')
args = [a for a in sys.argv[1:] if not a.startswith('--')]
CSV = args[0]; SL = int(args[1]) if len(args) > 1 else 40; TP = int(args[2]) if len(args) > 2 else 40
PREFER_NT = '--nt' in sys.argv; YEAR = 2026

def trades_from_csv(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        lines = f.read().split('\n')
    hdr = None
    for line in lines[1:]:
        if not line.strip(): break
        if hdr is None: hdr = line.split(','); continue
        r = next(csv.reader([line])); rows.append(dict(zip(hdr, r)))
    return rows

def parse_et(s):   # "09/11 09:53:15 ET" from the CSV, or an epoch-seconds int from a raw rt_trades JSON dump
    if isinstance(s, (int, float)): return datetime.datetime.fromtimestamp(s, ET)
    d, t, _ = s.split(' '); mo, da = map(int, d.split('/')); hh, mm, ss = map(int, t.split(':'))
    return datetime.datetime(YEAR, mo, da, hh, mm, ss, tzinfo=ET)

def trades_from_json(path):   # raw localStorage rt_trades array (entryTime = epoch seconds)
    out = []
    for i, t in enumerate(json.load(open(path, encoding='utf-8')), 1):
        out.append({'idx': str(i), 'side': t['side'], 'qty': t['qty'], 'entryTime': t['entryTime'], 'entry': t['entry'], 'pnl': t['pnl'],
                    'R': f"{t['R']:.2f}" if t.get('R') is not None else '', 'sym': t.get('sym', 'NQ'), 'stopTicks': t.get('stopTicks'), 'ticks': t.get('ticks')})
    return out

_tapes = {}
def tape(sym, day):
    key = (sym, day)
    if key in _tapes: return _tapes[key]
    cands = [f'{sym}_{day}.nt.json', f'{sym}_{day}.json'] if PREFER_NT else [f'{sym}_{day}.json', f'{sym}_{day}.nt.json']
    for c in cands:
        p = os.path.join(DATA, c)
        if os.path.exists(p):
            d = json.load(open(p)); t0 = d['t0']
            _tapes[key] = (c, [t0 + x for x in d['dt']], d['p']); return _tapes[key]
    _tapes[key] = None; return None

def trading_day(dt):   # ET trading day key (18:00 -> 17:00)
    return (dt + datetime.timedelta(hours=6)).strftime('%Y-%m-%d')

def simulate(tr):
    ent = parse_et(tr['entryTime']); px = float(tr['entry']); long = tr['side'] == 'long'
    tp = tape(tr.get('sym') or 'NQ', trading_day(ent))
    if not tp: return {'res': 'no tape', 'ticks': 0}
    name, ms, p = tp
    ems = int(ent.timestamp() * 1000)
    # first print at/after the entry second; prefer the first print AT the entry price within the next 60 s
    import bisect
    i = bisect.bisect_left(ms, ems)
    j = i
    while j < len(p) and ms[j] < ems + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    stop = px - SL * TICK if long else px + SL * TICK
    tgt = px + TP * TICK if long else px - TP * TICK
    for k in range(i + 1, len(p)):
        v = p[k]
        if long:
            if v <= stop: return {'res': 'loss', 'ticks': -SL, 'at': ms[k], 'tape': name}
            if v >= tgt: return {'res': 'win', 'ticks': TP, 'at': ms[k], 'tape': name}
        else:
            if v >= stop: return {'res': 'loss', 'ticks': -SL, 'at': ms[k], 'tape': name}
            if v <= tgt: return {'res': 'win', 'ticks': TP, 'at': ms[k], 'tape': name}
    last = p[-1]; t = round((last - px) / TICK) * (1 if long else -1)
    return {'res': 'open@close', 'ticks': t, 'at': ms[-1], 'tape': name}

def fmt(ms): return datetime.datetime.fromtimestamp(ms / 1000, ET).strftime('%H:%M:%S')

rows = trades_from_json(CSV) if CSV.lower().endswith('.json') else trades_from_csv(CSV)
print(f"{len(rows)} trades in {os.path.basename(CSV)} -> fixed bracket stop {SL}t / target {TP}t (1:{TP/SL:g})\n")
print(f"{'#':>2} {'side':5} {'entry time':17} {'entry':>9} {'orig':>8} {'origR':>6}   {'40/40':10} {'ticks':>6} {'hit at':8} tape")
w = l = o = 0; net = 0
for tr in rows:
    s = simulate(tr)
    net += s['ticks']
    if s['res'] == 'win': w += 1
    elif s['res'] == 'loss': l += 1
    else: o += 1
    et_s = tr['entryTime'][:14] if isinstance(tr['entryTime'], str) else parse_et(tr['entryTime']).strftime('%m/%d %H:%M:%S')
    print(f"{tr['idx']:>2} {tr['side']:5} {et_s:17} {float(tr['entry']):9.2f} {float(tr['pnl']):8.0f} {tr['R'] or '-':>6}   {s['res']:10} {s['ticks']:>+6} {fmt(s['at']) if 'at' in s else '':8} {s.get('tape','')}")
n = w + l
print(f"\nwins {w}  losses {l}  other {o}  -> win rate {w / n * 100 if n else 0:.0f}% (of {n} decided)  net {net:+d} ticks = {net * 5:+.0f} $ per contract (NQ)  expectancy {net / len(rows):+.1f} t/trade")
