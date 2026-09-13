"""Gzip the big dataset files next to their JSON sources (only when the source is newer). The app fetches
the .json.gz versions (see fetchJSON in app.js); the raw .json stay local for the converters/scripts.
Usage: py pack_gz.py            (chunks, multi datasets, tick tapes)"""
import glob, gzip, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data')
PATTERNS = ['chunks/*/20*.json', 'NQ_multi.json', 'ES_multi.json', 'tick/*.json']
n = 0; tot = 0
for pat in PATTERNS:
    for src in sorted(glob.glob(os.path.join(ROOT, pat))):
        dst = src + '.gz'
        if os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src): tot += os.path.getsize(dst); continue
        with open(src, 'rb') as a, gzip.open(dst, 'wb', compresslevel=6) as b: b.write(a.read())
        n += 1; tot += os.path.getsize(dst)
print(f"packed {n} new file(s); gz total {tot / 1e6:.0f} MB")
