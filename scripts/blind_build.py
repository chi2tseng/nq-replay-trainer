"""Blind setup test data: for every trade, the signal bar (last COMPLETED 2000t bar before the entry print) + the 100 bars before it.
Nothing after the signal bar is exported. Prices are stored as ticks relative to the entry price, so the chart carries no absolute level / date.
Bars are built exactly like the app did when these trades were taken (2000 CONTRACTS per bar, before the 1.077 trades change) — same as plot_setups.py.

Usage: py blind_build.py <out.json> <trades.csv...>
"""
import sys, os, json, bisect, datetime, random
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
OUT = sys.argv[1]; files = sys.argv[2:]
sys.argv = [sys.argv[0]] + files
exec(open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('def one_contract')[0])   # trades, paths, tape(), parse_et(), trading_day(), TICK, ET, DATA

BAR, N_PRIOR, STD_TP = 2000, 100, 50
def tick_bars(day):
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s = d['p'], d['s']
    t0, dt = d['t0'], d['dt']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        if cur is None or acc >= BAR: cur = {'o': p[i], 'h': p[i], 'l': p[i], 'c': p[i], 'si': i, 'ei': i, 't': t0 + dt[i]}; bars.append(cur); acc = 0
        cur['h'] = max(cur['h'], p[i]); cur['l'] = min(cur['l'], p[i]); cur['c'] = p[i]; cur['ei'] = i; acc += s[i]
    return bars
def prev_day(day):
    d = datetime.date.fromisoformat(day)
    for k in range(1, 6):
        c = (d - datetime.timedelta(days=k)).isoformat()
        if os.path.exists(os.path.join(DATA, f'NQ_{c}.json')): return c
    return None
def one(pp, tgt):   # same walk as sim_fixed_sweep.py: original stop, fixed target
    for f in pp['fav']:
        if f <= -pp['sl']: return -pp['sl']
        if f >= tgt: return tgt
    return pp['fav'][-1] if pp['fav'] else 0

assert len(paths) == len(trades), f'{len(trades) - len(paths)} trade(s) had no tape'
cache, emac, out, warn = {}, {}, [], []
EMA_N = 21
def ema(vals, n):   # app.js emaArr: seed = first value, k = 2/(n+1)
    k, o, prev = 2 / (n + 1), [], None
    for v in vals: prev = v if prev is None else v * k + prev * (1 - k); o.append(prev)
    return o
for n, (tr, pp) in enumerate(zip(trades, paths), 1):
    ent = parse_et(tr['entryTime']); day = trading_day(ent)
    name, ms, p = tape('NQ', day)
    if day not in cache: cache[day] = tick_bars(day)
    bars = cache[day]; px = float(tr['entry']); long = tr['side'] == 'long'; sl = int(tr['stopTicks'])
    ems = int(ent.timestamp() * 1000); i = bisect.bisect_left(ms, ems); j = i
    while j < len(p) and ms[j] < ems + 60000:        # the entry print = first print at the entry price within 60 s (same rule as the sims)
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    ei = next(k for k, b in enumerate(bars) if b['ei'] >= i)   # entry bar = bar holding the entry print
    si = ei - 1                                                  # signal bar = last completed bar before it
    # one continuous series = previous trading day's bars + this day's bars: tops the window up to 100 prior bars when the day
    # is young, and warms the EMA up (the app seeds its EMA with the first close of what it loaded: same formula, longer lead-in)
    pd = prev_day(day)
    if pd and pd not in cache: cache[pd] = tick_bars(pd)
    prev = cache[pd] if pd else []
    full = prev + bars; fs = len(prev) + si                      # signal bar's index in the full series
    ws = max(0, fs - N_PRIOR); win = full[ws: fs + 1]
    if len(win) < N_PRIOR + 1: warn.append(f'#{n} {day}: only {len(win) - 1} bars before the signal bar')
    assert all(b['ei'] < i for b in full[len(prev): fs + 1]), 'leak: a bar at/after the entry print'
    brk = len(prev) - ws if ws < len(prev) else None             # window index of this day's first bar (18:00 ET)
    if day not in emac: emac[day] = ema([b['c'] for b in full], EMA_N)
    ema_w = emac[day][ws: fs + 1]
    rel = lambda v: round((v - px) / TICK)
    sig = bars[si]; trig = (px - sig['h']) / TICK if long else (sig['l'] - px) / TICK   # ticks beyond the signal-bar extreme (1 = classic stop entry)
    tod = lambda b: datetime.datetime.fromtimestamp(b['t'] / 1000, ET).strftime('%H:%M')
    act = float(tr.get('pnl') or 0); ticks = int(round(float(tr.get('ticks') or 0)))
    std = one(pp, STD_TP)
    out.append({
        'k': n, 'side': tr['side'], 'stop': sl, 'tp': int(tr.get('tpTicks') or 0), 'sigTime': tod(sig),
        'bars': [[rel(b['o']), rel(b['h']), rel(b['l']), rel(b['c'])] for b in win],
        'tod': [tod(b) for b in win], 'brk': brk, 'ema': [round((v - px) / TICK, 2) for v in ema_w],
        # --- revealed only after the picks are done ---
        'date': day, 'entryTime': tr['entryTime'], 'month': day[:7], 'trig': round(trig, 2),
        'act': {'win': act > 0, 'ticks': ticks, 'pnl': act, 'exit': tr.get('exitType', '')},
        'std': {'win': std > 0, 'ticks': std},
    })
json.dump({'built': datetime.datetime.now(ET).strftime('%Y-%m-%d %H:%M ET'), 'barTicks': BAR, 'prior': N_PRIOR, 'stdTp': STD_TP, 'files': [os.path.basename(f) for f in files], 'trades': out},
          open(OUT, 'w', encoding='utf-8'), separators=(',', ':'))
w = sum(t['act']['win'] for t in out); ws = sum(t['std']['win'] for t in out)
trig = [t['trig'] for t in out]
print(f'{len(out)} trades -> {OUT} ({os.path.getsize(OUT) // 1024} KB)')
print(f'actual win {w}/{len(out)} = {w / len(out) * 100:.1f}%   |   std {STD_TP}t target win {ws}/{len(out)} = {ws / len(out) * 100:.1f}%')
print(f'entry vs signal-bar extreme (ticks): 1t={sum(1 for x in trig if x == 1)}  <=0={sum(1 for x in trig if x <= 0)}  2..8={sum(1 for x in trig if 1 < x <= 8)}  >8={sum(1 for x in trig if x > 8)}')
for x in warn: print('warn', x)
