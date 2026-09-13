"""Convert a NinjaTrader Historical Data Export (tick, *.Last.txt) into the app's per-day tick files.

Row format: `yyyyMMdd HHmmss fffffff;last;bid;ask;volume`, timestamps in UTC (verified: the daily
17:00-18:00 ET maintenance halt shows up as an empty 21:00 UTC hour). Rows are re-bucketed by ET
trading day (18:00 -> 17:00 ET) like the Databento converter, same output schema:
  {day, sym, contract, tick, t0, dt:[ms], p:[price], s:[size], bo:[bid offset], ao:[ask offset], ev:[event flag]}
`ev` = 1 on EVERY row: NinjaTrader's own tick charts count each print of the Last stream as one tick, so
NT-source tick bars replay what a NinjaTrader 2000-tick chart shows. (The export's timestamps are only
ms-resolution, so grouping by timestamp would merge separate CME events and is NOT a Tradovate proxy.)
Files are written as NQ_<day>.nt.json + index_NQ_nt.json so a Databento tape for the same day can coexist.

Usage: py convert_nt_tick.py "<export.txt>" [outdir]
"""
import sys, os, json, datetime
from zoneinfo import ZoneInfo

SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "D:/Tools/replay-trainer/data/tick"
TICK = 0.25
ET = ZoneInfo("America/New_York"); UTC = datetime.timezone.utc
contract = os.path.basename(SRC).split('.')[0]          # "NQ 09-26"

days = {}                                               # trading day -> columns
prev_ts = None
with open(SRC) as f:
    for line in f:
        ts, last, bid, ask, vol = line.rstrip('\n').split(';')
        dt = datetime.datetime(int(ts[0:4]), int(ts[4:6]), int(ts[6:8]), int(ts[9:11]), int(ts[11:13]), int(ts[13:15]), int(ts[16:19]) * 1000, tzinfo=UTC)
        tday = (dt.astimezone(ET) + datetime.timedelta(hours=6)).strftime('%Y-%m-%d')
        c = days.setdefault(tday, {'ms': [], 'p': [], 's': [], 'bo': [], 'ao': [], 'ev': []})
        p = float(last)
        c['ms'].append(int(dt.timestamp() * 1000)); c['p'].append(p); c['s'].append(int(vol))
        c['bo'].append(int(round((float(bid) - p) / TICK))); c['ao'].append(int(round((float(ask) - p) / TICK)))
        c['ev'].append(1)

written = []
for day in sorted(days):
    c = days[day]; n = len(c['p'])
    if n < 5000: print(f"  skip {day}: only {n} rows"); continue
    t0 = c['ms'][0]
    rec = {"day": day, "sym": "NQ", "src": "nt", "contract": contract, "tick": TICK, "t0": t0, "dt": [m - t0 for m in c['ms']],
           "p": c['p'], "s": c['s'], "bo": c['bo'], "ao": c['ao'], "ev": c['ev']}
    path = os.path.join(OUT, f"NQ_{day}.nt.json"); json.dump(rec, open(path, "w")); written.append(day)
    print(f"  {day} {n:,} prints, {sum(c['ev']):,} events, {os.path.getsize(path)/1e6:.1f} MB")

ip = os.path.join(OUT, "index_NQ_nt.json")
index = sorted(set(json.load(open(ip)) if os.path.exists(ip) else []) | set(written))
json.dump(index, open(ip, "w"))
print(f"-> index_NQ_nt.json: {len(index)} days, {index[0]} .. {index[-1]}")
