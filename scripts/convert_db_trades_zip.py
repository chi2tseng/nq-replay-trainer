"""Convert a Databento `trades` download (JSON lines, zstd, one file per UTC day) into per-day tick files.

Same output schema as convert_tbbo_zip.py minus bo/ao (the trades schema carries no quotes):
  {day, sym, src:"db", contract, tick, t0, dt, p, s, ev}
Re-buckets UTC files into ET trading days (18:00 -> 17:00), keeps the highest-volume outright
instrument per file (parent symbol NQ.FUT also returns calendar spreads like NQU6-NQZ6),
ev = 1 on the first print of each CME match event (ts_event change).

Usage: py convert_db_trades_zip.py <zip> [outdir]
"""
import sys, os, io, json, zipfile, datetime, collections
import zstandard as zs
from zoneinfo import ZoneInfo

ZIP = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else "D:/Tools/replay-trainer/data/tick"
TICK = 0.25
ET = ZoneInfo("America/New_York")
z = zipfile.ZipFile(ZIP)
files = sorted(x for x in z.namelist() if x.endswith('.trades.json.zst'))
print(f"{len(files)} day files", flush=True)

buf = {}; written = []
def flush(day):
    c = buf.pop(day); n = len(c['p'])
    if n < 5000: print(f"  skip {day}: {n} prints", flush=True); return
    t0 = c['ms'][0]
    rec = {"day": day, "sym": "NQ", "src": "db", "contract": c['sym'], "tick": TICK, "t0": t0,
           "dt": [m - t0 for m in c['ms']], "p": c['p'], "s": c['s'], "ev": c['ev']}
    path = os.path.join(OUT, f"NQ_{day}.json"); json.dump(rec, open(path, "w")); written.append(day)
    print(f"  {day} {c['sym']} {n:,} prints {sum(c['ev']):,} events {os.path.getsize(path)/1e6:.1f} MB", flush=True)

for name in files:
    rows = []
    with io.TextIOWrapper(zs.ZstdDecompressor().stream_reader(z.open(name)), encoding='utf-8') as f:
        for line in f:
            r = json.loads(line)
            if r.get('action') != 'T': continue
            sym = r.get('symbol', '')
            if '-' in sym: continue                     # calendar spread
            rows.append((sym, r['hd']['ts_event'], float(r['price']), int(r['size'])))
    if not rows: continue
    vol = collections.Counter(); [vol.__setitem__(s, vol[s] + q) for s, _, _, q in rows]
    top = max(vol, key=vol.get)
    prev = None
    for sym, ts, px, sz in rows:
        if sym != top: continue
        dt = datetime.datetime.fromisoformat(ts[:26] + '+00:00')   # ns -> us precision is enough for ms
        tday = (dt.astimezone(ET) + datetime.timedelta(hours=6)).strftime('%Y-%m-%d')
        c = buf.setdefault(tday, {'sym': top, 'ms': [], 'p': [], 's': [], 'ev': []})
        c['ms'].append(int(dt.timestamp() * 1000)); c['p'].append(px); c['s'].append(sz)
        c['ev'].append(1 if ts != prev else 0); prev = ts
    newest = max(buf)
    for day in sorted(d for d in buf if d < newest): flush(day)
for day in sorted(buf): flush(day)

ip = os.path.join(OUT, "index_NQ.json")
index = sorted(set(json.load(open(ip)) if os.path.exists(ip) else []) | set(written))
json.dump(index, open(ip, "w"))
print(f"-> index_NQ.json {len(index)} days {index[0]} .. {index[-1]}")
