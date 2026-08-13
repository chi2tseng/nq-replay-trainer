"""Blend multiple resolutions of the same instrument into ONE series that always shows the
FINEST data available at any given time: recent weeks at 5s, the prior couple months at 15s,
everything else (and the daily-fresh tail) at 1m.

Merge rule per symbol: walk tiers finest -> coarsest. Each tier's own files are concatenated
and deduped first (later files in the same tier win on overlap, so list an extension AFTER
the original snapshot). Then a bar from a coarser tier is DROPPED if its time falls inside the
[min,max] time span already claimed by any finer tier — this is safe because the market is
closed at the same instants for every resolution, so a finer tier's own span already accounts
for every real weekend/holiday gap; a coarser tier can't fill in anything the finer tier is
missing without lying.

detectBaseTf() in the app auto-detects the finest bar spacing present, so no other app-side
change is needed for a mixed-resolution file to just work — it will simply look sparse if you
zoom to a timeframe finer than what's available for that particular historical window.

Usage: python merge_multires.py [SYM ...]     (default: NQ ES)
"""
import json, os, sys, datetime

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")

# tiers, finest first; each tier = list of files (later files win on internal-tier overlap).
# 15s is DELIBERATELY excluded here: it now covers the full 3-year history (scripts/fetch_15s_bulk.py
# + split_monthly.py), and folding all of that into this file would balloon the DEFAULT fast-load
# dataset back to 400MB+ — the exact browser-crash problem the multi-res design exists to avoid.
# The full 15s history lives in data/chunks/<SYM>/ instead, loaded on demand by deep-history mode
# (DATASETS[].deep) — this file stays "5s recent + 1m everywhere else," small and always fresh.
TIERS = {
    "NQ": [
        ["NQ_db_5s.json", "NQ_db_5s_ext.json"],
        ["NQ_db_1m.json"],
    ],
    "ES": [
        ["ES_db_5s.json", "ES_db_5s_ext.json"],
        ["ES_db_1m.json"],
    ],
}
OUT = {"NQ": "NQ_multi.json", "ES": "ES_multi.json"}

def load_tier(files):
    by_t = {}
    for fn in files:
        p = os.path.join(DATA, fn)
        if not os.path.exists(p):
            continue
        for b in json.load(open(p)):
            by_t[b["time"]] = b          # later file in the list wins on exact-timestamp overlap
    return [by_t[t] for t in sorted(by_t)]

def gap_report(bars, label):
    if len(bars) < 2:
        return
    deltas = [bars[i + 1]["time"] - bars[i]["time"] for i in range(len(bars) - 1)]
    step = min(deltas)
    big = [(bars[i]["time"], d) for i, d in enumerate(deltas) if d > max(step * 20, 3600)]
    if big:
        print(f"    {label}: {len(big)} gap(s) > {max(step*20,3600)}s (largest {max(d for _,d in big)}s) — expected on weekends/holidays, eyeball the rest:")
        for t, d in sorted(big, key=lambda x: -x[1])[:5]:
            print(f"      {datetime.datetime.fromtimestamp(t, datetime.timezone.utc)} UTC  +{d}s gap")

def merge_symbol(sym):
    tiers = TIERS[sym]
    loaded = [load_tier(files) for files in tiers]
    claimed = []       # (lo, hi) time ranges already spoken for by a finer tier
    out = []
    for files, bars in zip(tiers, loaded):
        if not bars:
            continue
        lo, hi = bars[0]["time"], bars[-1]["time"]
        keep = [b for b in bars if not any(c_lo <= b["time"] <= c_hi for c_lo, c_hi in claimed)]
        step = round((bars[1]["time"] - bars[0]["time"]) if len(bars) > 1 else 0)
        present = [f for f in files if os.path.exists(os.path.join(DATA, f))]
        print(f"  tier ~{step}s  {'+'.join(present) or '(missing)'}: {len(bars)} native, {len(keep)} kept after de-dupe vs finer tiers")
        gap_report(bars, f"~{step}s tier")
        out.extend(keep)
        claimed.append((lo, hi))
    out.sort(key=lambda b: b["time"])
    if not out:
        print(f"  {sym}: no source files found, skipped"); return
    p = os.path.join(DATA, OUT[sym])
    json.dump(out, open(p, "w"))
    kb = os.path.getsize(p) / 1024
    f0 = datetime.datetime.fromtimestamp(out[0]["time"], datetime.timezone.utc); f1 = datetime.datetime.fromtimestamp(out[-1]["time"], datetime.timezone.utc)
    print(f"  -> {OUT[sym]}: {len(out)} bars, {f0}..{f1} UTC, {kb:,.0f} KB")

for sym in (sys.argv[1:] or ["NQ", "ES"]):
    print(f"=== {sym} ===")
    merge_symbol(sym)
