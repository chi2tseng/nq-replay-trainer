"""Convert a Databento TBBO download (DBN/zstd, one file per day) into the app's per-day tick files.

TBBO = every trade PLUS the best bid/offer immediately before it, so the replay can fill a market
buy at the ask and a market sell at the bid instead of pretending both happen at the last print.

The download was requested with stype_in=parent ("NQ.FUT"), so each day holds every NQ contract —
outright front month, back months, and calendar spreads. We keep only the single highest-volume
instrument of the day, which is always the outright front month (on 2026-03-04: NQH6 with 587,608
contracts vs 4,882 for the next one). Each day is replayed on its own, so the quarterly roll between
days needs no adjustment.

Output (extends the old trades-only format with two arrays):
  {day, sym, tick, t0, dt:[ms since t0], p:[price], s:[size], bo:[bid offset], ao:[ask offset]}
bo/ao are the bid/ask as a signed count of TICKS away from that trade's price — small integers, far
cheaper in JSON than repeating full prices, and exact since every quote sits on a tick boundary.

Usage: py convert_tbbo_zip.py <zip> [outdir] [--limit N]
"""
import sys, os, json, zipfile, datetime, collections
import databento as db

ZIP = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else "D:/Tools/replay-trainer/data/tick"
LIMIT = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else None
TICK = 0.25
os.makedirs(OUT, exist_ok=True)

z = zipfile.ZipFile(ZIP)
days = sorted(x for x in z.namelist() if x.endswith('.dbn.zst'))
if LIMIT:
    days = days[:LIMIT]
print(f"{len(days)} day files in {os.path.basename(ZIP)}", flush=True)

# Databento splits these files by UTC day (19:00 ET -> 19:00 ET), but the app's sessions are ET
# TRADING days (18:00 ET -> 17:00 ET), which is also how the older tick files were cut. Re-bucket
# across file boundaries: read in order, and once we are into a later trading day the earlier one
# can no longer gain rows, so flush it.
import numpy as np
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York")

buf = {}            # trading day -> dict of column lists
written, skipped = [], []

def flush(day):
    c = buf.pop(day)
    n = len(c['p'])
    if n < 5000:
        skipped.append((day, f"only {n} trades — holiday/half day")); return
    t0 = int(c['ms'][0])
    rec = {"day": day, "sym": "NQ", "contract": c['sym'], "tick": TICK, "t0": t0,
           "dt": [int(m - t0) for m in c['ms']], "p": c['p'], "s": c['s'], "bo": c['bo'], "ao": c['ao'], "ev": c['ev']}
    path = os.path.join(OUT, f"NQ_{day}.json")
    json.dump(rec, open(path, "w"))
    written.append(day)
    print(f"    flushed {day} {c['sym']} {n:,} trades {os.path.getsize(path)/1024/1024:.1f} MB", flush=True)

for k, name in enumerate(days, 1):
    store = db.DBNStore.from_bytes(z.read(name))
    df = store.to_df()
    if df is None or not len(df):
        continue
    top = df.groupby('instrument_id')['size'].sum().idxmax()
    d = df[df.instrument_id == top]
    sym = str(d['symbol'].iloc[0]) if 'symbol' in d.columns and d['symbol'].notna().any() else str(top)

    et = d.index.tz_convert(ET)
    tday = (et + datetime.timedelta(hours=6)).strftime('%Y-%m-%d')   # 18:00 ET boundary -> midnight
    ms = (d.index.view('int64') // 1_000_000)
    # ev[i]=1 marks the first print of a CME match event (all prints of one aggressor order share
    # ts_event). Counting EVENTS, not prints, is how CME/Tradovate-style tick charts count: a sweep
    # filling at 3 price levels is one tick. On 2026-03-04: 427,956 prints but 372,974 events.
    tev = d['ts_event'].values.astype('int64')
    evarr = np.ones(len(tev), dtype=int); evarr[1:] = (tev[1:] != tev[:-1]).astype(int)
    px = d['price'].to_numpy(); bid = d['bid_px_00'].to_numpy(); ask = d['ask_px_00'].to_numpy()
    bo = np.where(np.isnan(bid), 0, np.round((bid - px) / TICK)).astype(int)
    ao = np.where(np.isnan(ask), 0, np.round((ask - px) / TICK)).astype(int)
    sz = d['size'].to_numpy().astype(int)

    for day in dict.fromkeys(tday):                                  # preserves order, dedupes
        m = (tday == day)
        c = buf.setdefault(day, {'sym': sym, 'ms': [], 'p': [], 's': [], 'bo': [], 'ao': [], 'ev': []})
        c['ms'] += ms[m].tolist()
        c['p']  += [round(float(x), 2) for x in px[m]]
        c['s']  += sz[m].tolist()
        c['bo'] += bo[m].tolist()
        c['ao'] += ao[m].tolist()
        c['ev'] += evarr[m].tolist()

    newest = max(buf)
    for day in sorted([x for x in buf if x < newest]):
        flush(day)
    if k % 10 == 0 or k == len(days):
        print(f"  [{k}/{len(days)}] {name[11:19]} -> {len(written)} days written", flush=True)

for day in sorted(buf):
    flush(day)

index = sorted(set(written))
json.dump(index, open(os.path.join(OUT, "index.json"), "w"))
print(f"\n-> {len(index)} day files, {index[0]} .. {index[-1]}")
print(f"-> index.json rewritten ({len(index)} days)")
if skipped:
    print(f"-> skipped {len(skipped)}:")
    for n, why in skipped[:10]:
        print(f"     {n}: {why}")
