"""Al Brooks second-entry (H2 / L2) backtest on NQ 2000-tick bars, filled on the real tick tape.

Bars: 2000 contracts per bar (same rule as the app's Databento tick bars), built from the 18:00 ET session open.
Setup (long; short is the mirror):
  trend    : swing-high bar is the highest high of the previous TREND_LOOKBACK bars, its close is above EMA20,
             and EMA20 is rising (EMA20 now > EMA20 ten bars earlier)
  pullback : after the swing high, bars making lower highs; H1 = first bar whose high exceeds the prior bar's high;
             after H1 the pullback must resume (a bar with a lower high), then the next bar whose high exceeds the
             prior bar's high is the H2 entry bar. The SIGNAL bar is the bar just before it.
  filters  : signal bar closes in the top 30% of its range ((close-low)/(high-low) >= 0.7);
             at least MIN_PB_BARS bars from the swing high to the signal bar; signal bar and entry inside 09:30-16:00 ET
  orders   : buy stop at signal high + 1 tick, valid only during the H2 bar; stop = signal low - 1 tick; target = +40 ticks;
             flatten at 16:00 ET; one position at a time
Usage: py bt_brooks_h2.py [--days N] [--tp 40] [--minpb 5]
"""
import sys, os, json, glob, datetime, bisect, collections
from zoneinfo import ZoneInfo
ET = ZoneInfo('America/New_York'); TICK = 0.25
DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'tick')
def arg(name, default):
    return type(default)(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default
BAR_TICKS = arg('--bar', 2000); TP = arg('--tp', 40); MIN_PB = arg('--minpb', 5); EMA_N = 20; TREND_LOOKBACK = 30; DAYS = arg('--days', 0)
TPR = arg('--tpr', 0.0); MAXRISK = arg('--maxrisk', 0)   # --tpr 1 = target is 1x the signal-bar risk; --maxrisk 60 = skip signals whose stop is wider than 60 ticks
CLOSE_POS = 0.7

def et(ms): return datetime.datetime.fromtimestamp(ms / 1000, ET)

def build_bars(ms, p, s):
    bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR_TICKS:
            cur = {'i0': i, 'o': p[i], 'h': p[i], 'l': p[i], 'c': p[i], 't': ms[i]}; bars.append(cur); acc = 0
        if p[i] > cur['h']: cur['h'] = p[i]
        if p[i] < cur['l']: cur['l'] = p[i]
        cur['c'] = p[i]; cur['i1'] = i; cur['t1'] = ms[i]; acc += s[i]
    return bars

def ema(vals, n):
    out = [None] * len(vals); k = 2 / (n + 1); e = None
    for i, v in enumerate(vals):
        e = v if e is None else v * k + e * (1 - k); out[i] = e
    return out

def find_setups(bars, rth):
    """yield (side, swing_idx, signal_idx, entry_idx)"""
    closes = [b['c'] for b in bars]; E = ema(closes, EMA_N); n = len(bars); out = []
    for side in ('long', 'short'):
        sgn = 1 if side == 'long' else -1
        hi = (lambda b: b['h']) if side == 'long' else (lambda b: -b['l'])      # "high" in trend direction
        lo = (lambda b: b['l']) if side == 'long' else (lambda b: -b['h'])
        i = TREND_LOOKBACK + 10
        while i < n - 2:
            b = bars[i]
            # trend extreme: highest "high" of the last TREND_LOOKBACK bars, close beyond EMA, EMA sloping with the trend
            if hi(b) >= max(hi(x) for x in bars[i - TREND_LOOKBACK:i]) and sgn * (b['c'] - E[i]) > 0 and sgn * (E[i] - E[i - 10]) > 0:
                # walk the pullback
                j = i + 1; count = 0; need_resume = False; found = None
                while j < n - 1:
                    if hi(bars[j]) > hi(b): break                                   # new extreme: pullback over without an entry
                    if hi(bars[j]) > hi(bars[j - 1]):                                # this bar takes out the prior bar's high
                        if count == 0: count = 1; need_resume = True
                        elif count == 1 and not need_resume: found = j; break         # H2 entry bar
                    elif hi(bars[j]) < hi(bars[j - 1]):
                        if count == 1: need_resume = False                            # pullback resumed after H1
                    j += 1
                if found:
                    sig = found - 1; sb = bars[sig]; rng = sb['h'] - sb['l']
                    pos = ((sb['c'] - sb['l']) / rng) if rng > 0 else 0.5
                    if side == 'short': pos = 1 - pos
                    if pos >= CLOSE_POS and (sig - i) >= MIN_PB and rth(sb['t1']) and rth(bars[found]['t']):
                        out.append((side, i, sig, found))
                    i = found + 1; continue
            i += 1
    return sorted(out, key=lambda x: x[3])

def run_day(path):
    d = json.load(open(path)); t0 = d['t0']; ms = [t0 + x for x in d['dt']]; p = d['p']; s = d['s']
    day = d['day']
    open_ms = int(datetime.datetime.strptime(day, '%Y-%m-%d').replace(tzinfo=ET, hour=9, minute=30).timestamp() * 1000)
    close_ms = open_ms + int(6.5 * 3600 * 1000)
    rth = lambda t: open_ms <= t < close_ms
    bars = build_bars(ms, p, s)
    trades = []; busy_until = -1
    for side, swing, sig, ent in find_setups(bars, rth):
        if bars[ent]['i0'] <= busy_until: continue                     # one position at a time
        sb = bars[sig]; long = side == 'long'
        entry = sb['h'] + TICK if long else sb['l'] - TICK
        stop = sb['l'] - TICK if long else sb['h'] + TICK
        risk0 = round(abs(entry - stop) / TICK)
        if MAXRISK and risk0 > MAXRISK: continue
        tp_t = round(risk0 * TPR) if TPR else TP
        tgt = entry + tp_t * TICK if long else entry - tp_t * TICK
        eb = bars[ent]; filled = None
        for k in range(eb['i0'], eb['i1'] + 1):                        # order lives only during the H2 bar
            if (p[k] >= entry) if long else (p[k] <= entry): filled = k; break
        if filled is None: continue
        fill_px = max(p[filled], entry) if long else min(p[filled], entry)   # gap-through fills at the print
        res = None; mfe = 0
        for k in range(filled + 1, len(p)):
            v = p[k]; fav = (v - fill_px) if long else (fill_px - v); mfe = max(mfe, fav)
            if ms[k] >= close_ms: res = ('eod', round(((p[k - 1] - fill_px) if long else (fill_px - p[k - 1])) / TICK), ms[k - 1]); break
            if (v <= stop) if long else (v >= stop): res = ('stop', round(((stop - fill_px) if long else (fill_px - stop)) / TICK), ms[k]); break
            if (v >= tgt) if long else (v <= tgt): res = ('target', round(((tgt - fill_px) if long else (fill_px - tgt)) / TICK), ms[k]); break
        if res is None: res = ('eod', round(((p[-1] - fill_px) if long else (fill_px - p[-1])) / TICK), ms[-1])
        risk = round(abs(entry - stop) / TICK)
        trades.append({'day': day, 'side': side, 'sig_t': et(sb['t1']).strftime('%H:%M:%S'), 'entry': fill_px, 'risk_t': risk, 'exit': res[0], 'ticks': res[1], 'R': res[1] / risk if risk else 0, 'mfe_t': round(mfe / TICK), 'pb_bars': sig - swing, 'sig_pos': round(((sb['c'] - sb['l']) / (sb['h'] - sb['l'])) if sb['h'] > sb['l'] else 0.5, 2)})
        busy_until = bisect.bisect_left(ms, res[2])
    return trades, len(bars)

if __name__ == '__main__':
    files = sorted(f for f in glob.glob(os.path.join(DATA, 'NQ_*.json')) if '.nt.' not in f)
    if DAYS: files = files[-DAYS:]
    allt = []; nb = 0
    for k, f in enumerate(files, 1):
        t, n = run_day(f); allt += t; nb += n
        if k % 20 == 0: print(f'  {k}/{len(files)} days, {len(allt)} trades', flush=True)
    tag = f'tpr{TPR:g}' if TPR else f'tp{TP}'; tag += f'_maxrisk{MAXRISK}' if MAXRISK else ''
    out = os.path.join(os.path.dirname(DATA), '..', 'exports', f'bt_brooks_h2_{BAR_TICKS}t_{tag}.json')
    json.dump(allt, open(out, 'w'), indent=0)
    def summ(ts, label):
        if not ts: print(f'{label:12} no trades'); return
        w = [t for t in ts if t['ticks'] > 0]; l = [t for t in ts if t['ticks'] < 0]
        gw = sum(t['ticks'] for t in w); gl = -sum(t['ticks'] for t in l); net = sum(t['ticks'] for t in ts); R = sum(t['R'] for t in ts)
        print(f"{label:12} n={len(ts):4}  win {len(w)/len(ts)*100:4.0f}%  net {net:+6d}t (${net*5:+,.0f}/ct)  avg {net/len(ts):+5.1f}t  avgR {R/len(ts):+.2f}  PF {gw/gl if gl else float('inf'):.2f}  avg risk {sum(t['risk_t'] for t in ts)/len(ts):.0f}t  exits: " + ' '.join(f"{k}={v}" for k, v in collections.Counter(t['exit'] for t in ts).items()))
    print(f"\n{len(files)} days, {nb:,} bars of {BAR_TICKS}t, target {('%gR' % TPR) if TPR else str(TP) + 't'}{(', max risk %dt' % MAXRISK) if MAXRISK else ''}, min pullback {MIN_PB} bars, signal close >= {CLOSE_POS:.0%}\n")
    summ(allt, 'ALL'); summ([t for t in allt if t['side'] == 'long'], 'long'); summ([t for t in allt if t['side'] == 'short'], 'short')
    bym = collections.defaultdict(list)
    for t in allt: bym[t['day'][:7]].append(t)
    print('\nby month:')
    for m in sorted(bym): summ(bym[m], m)
    print(f'\ntrades -> {os.path.abspath(out)}')
