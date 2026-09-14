"""Render each trade as a 2000t candle chart: 40 bars before entry bar, entry bar, 40 after. Entry/stop/TP lines, exit marker.
Usage: py plot_setups.py <bar_ticks> <out_dir> <trades...>"""
import sys, os, json, bisect, datetime
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
BAR = int(sys.argv[1]); OUT = sys.argv[2]; sys.argv = [sys.argv[0]] + sys.argv[3:]; os.makedirs(OUT, exist_ok=True)
src = open(os.path.join(HERE, 'sim_tp_compare.py'), encoding='utf-8').read().split('# ---- per trade')[0]; exec(src)
N = 40
def tick_bars(day):
    d = json.load(open(os.path.join(DATA, f'NQ_{day}.json'))); p, s, ms = d['p'], d['s'], None
    t0, dt = d['t0'], d['dt']; bars = []; cur = None; acc = 0
    for i in range(len(p)):
        t = t0 + dt[i]
        if cur is None or acc >= BAR: cur = {'o': p[i], 'h': p[i], 'l': p[i], 'c': p[i], 'si': i, 'ei': i, 't': t}; bars.append(cur); acc = 0
        cur['h'] = max(cur['h'], p[i]); cur['l'] = min(cur['l'], p[i]); cur['c'] = p[i]; cur['ei'] = i; acc += s[i]
    return bars
cache = {}
for n, tr in enumerate(trades, 1):
    ent = parse_et(tr['entryTime']); day = trading_day(ent); name, ms, p = tape('NQ', day)
    if day not in cache: cache[day] = tick_bars(day)
    bars = cache[day]; px = float(tr['entry']); long = tr['side'] == 'long'; sl = int(tr['stopTicks']); tp = int(tr.get('tpTicks') or 40)
    i = bisect.bisect_left(ms, int(ent.timestamp() * 1000)); j = i
    while j < len(p) and ms[j] < ms[i] + 60000:
        if abs(p[j] - px) < 1e-9: i = j; break
        j += 1
    ei = next(k for k, b in enumerate(bars) if b['ei'] >= i)
    xt = parse_et(tr['exitTime']); xi_print = bisect.bisect_left(ms, int(xt.timestamp() * 1000)); xi = next((k for k, b in enumerate(bars) if b['ei'] >= xi_print), len(bars) - 1)
    lo, hi = max(0, ei - N), min(len(bars), ei + N + 1); win = bars[lo:hi]
    fig, ax = plt.subplots(figsize=(14, 7), dpi=110); fig.patch.set_facecolor('#111418'); ax.set_facecolor('#111418')
    for k, b in enumerate(win):
        x = lo + k; up = b['c'] >= b['o']; col = '#26a69a' if up else '#ef5350'
        ax.plot([x, x], [b['l'], b['h']], color=col, lw=1)
        ax.add_patch(plt.Rectangle((x - 0.35, min(b['o'], b['c'])), 0.7, max(abs(b['c'] - b['o']), TICK), color=col))
    stop = px - sl * TICK if long else px + sl * TICK; tgt = px + tp * TICK if long else px - tp * TICK
    for y, c, lab in ((px, '#e0e0e0', f'entry {px}'), (stop, '#ef5350', f'stop {sl}t'), (tgt, '#26a69a', f'TP {tp}t')):
        ax.axhline(y, xmin=(ei - lo) / len(win), color=c, lw=1, ls='--'); ax.text(hi - 0.5, y, lab, color=c, fontsize=9, va='bottom', ha='right')
    ax.axvspan(ei - 0.5, ei + 0.5, color='#ffffff', alpha=0.08)
    ax.annotate('', (ei, px), (ei, px - (12 if long else -12) * TICK), arrowprops=dict(arrowstyle='->', color='#ffd54f', lw=2))
    if lo <= xi < hi: ax.scatter([xi], [float(tr['exit'])], marker='x', s=80, color='#ffd54f', zorder=5)
    pnl = float(tr['pnl']); res = f"+{tp}t" if pnl > 0 else f"-{sl}t"
    ax.set_title(f"{os.environ.get('LABEL','')}#{n}  {tr['entryTime']}  {tr['side'].upper()} @ {px}   stop {sl}t  TP {tp}t   result {res}   ({BAR}t bars, ±{N})", color='#e0e0e0', fontsize=11, loc='left')
    ticks = list(range(lo, hi, 10)); ax.set_xticks(ticks)
    ax.set_xticklabels([datetime.datetime.fromtimestamp(bars[t]['t'] / 1000, ET).strftime('%H:%M') for t in ticks], color='#9aa0a6', fontsize=8)
    ax.tick_params(colors='#9aa0a6'); [s.set_color('#333') for s in ax.spines.values()]; ax.set_xlim(lo - 1, hi); ax.grid(color='#222', lw=0.5)
    fn = os.path.join(OUT, f"{n:02d}_{ent:%m%d_%H%M}_{tr['side']}.png"); fig.tight_layout(); fig.savefig(fn, facecolor=fig.get_facecolor()); plt.close(fig)
print(f'{len(trades)} charts -> {os.path.abspath(OUT)}')
