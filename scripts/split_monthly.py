"""Split a big 15s history file into one JSON per calendar month (GitHub-safe: each file is
well under the 100MB push limit) + an index the app can fetch cheaply to know what's available
before loading any bar data.

Usage: python split_monthly.py <SYM>            (reads data/<SYM>_db_15s.json)
  python split_monthly.py NQ
  python split_monthly.py ES
"""
import json, os, sys, datetime, collections

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
SYM = sys.argv[1]
SRC = os.path.join(DATA, f"{SYM}_db_15s.json")
OUTDIR = os.path.join(DATA, "chunks", SYM)
os.makedirs(OUTDIR, exist_ok=True)

try:
    from zoneinfo import ZoneInfo; ET = ZoneInfo("America/New_York")
    def trading_day(ts): return (datetime.datetime.fromtimestamp(ts, ET) + datetime.timedelta(hours=6)).strftime("%Y-%m-%d")  # 18:00 ET boundary -> midnight
except Exception:
    def trading_day(ts): return (datetime.datetime.fromtimestamp(ts, datetime.timezone.utc) + datetime.timedelta(hours=2)).strftime("%Y-%m-%d")

bars = json.load(open(SRC))
print(f"{SYM}: {len(bars):,} bars loaded from {os.path.basename(SRC)}")

by_month = collections.defaultdict(list)
for b in bars:
    d = datetime.datetime.fromtimestamp(b["time"], datetime.timezone.utc)
    by_month[d.strftime("%Y-%m")].append(b)

manifest = []
for month in sorted(by_month):
    mb = by_month[month]
    days = sorted(set(trading_day(b["time"]) for b in mb))
    p = os.path.join(OUTDIR, f"{month}.json")
    json.dump(mb, open(p, "w"))
    kb = os.path.getsize(p) / 1024
    manifest.append({"month": month, "bars": len(mb), "days": days, "kb": round(kb)})
    print(f"  {month}: {len(mb):,} bars, {len(days)} trading days, {kb:,.0f} KB")

json.dump(manifest, open(os.path.join(OUTDIR, "index.json"), "w"))
total_kb = sum(m["kb"] for m in manifest)
biggest = max(manifest, key=lambda m: m["kb"])
print(f"-> {len(manifest)} monthly files, {total_kb/1024:,.1f} MB total, largest {biggest['month']} = {biggest['kb']:,} KB")
print(f"-> data/chunks/{SYM}/index.json written ({len(manifest)} months)")
if biggest["kb"] > 90 * 1024:
    print(f"!! WARNING: {biggest['month']} is {biggest['kb']/1024:.0f} MB — near GitHub's 100MB/file limit, consider splitting by week instead")
