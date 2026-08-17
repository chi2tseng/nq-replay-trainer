"""FREE daily data update from Yahoo Finance — never pay for data.

Yahoo caps 1m history at ~8 days, so we MERGE each pull into the on-disk dataset
(fresh wins on overlap, so the still-forming last bar gets finalised next run) and the
file grows day by day.

Real CME futures, full ~23h Globex session, no API key, no cost.
Run daily via Task Scheduler (see scripts/setup_daily_yahoo.ps1).

Usage: python update_yahoo.py
"""
import json, os, sys, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__)); DATA = os.path.join(HERE, "..", "data")
APPEND_1M = [("NQ=F", "NQ_db_1m.json", 0.25), ("ES=F", "ES_db_1m.json", 0.25)]      # the only two series the app ships (accumulate, 8-day Yahoo window merged in)

def fetch(sym, interval, rng, tick):
    rt = lambda x: round(round(x / tick) * tick, 2)
    last_err = None
    for host in ("query1", "query2"):
        try:
            url = f"https://{host}.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(sym)}?range={rng}&interval={interval}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            d = json.load(urllib.request.urlopen(req, timeout=60))
            r = d["chart"]["result"][0]; ts = r["timestamp"]; q = r["indicators"]["quote"][0]
            o, h, l, c, v = q["open"], q["high"], q["low"], q["close"], q["volume"]
            out = []
            for i, t in enumerate(ts):
                if o[i] is None or h[i] is None or l[i] is None or c[i] is None: continue
                hi = rt(max(h[i], o[i], c[i])); lo = rt(min(l[i], o[i], c[i]))
                out.append({"time": int(t), "open": rt(o[i]), "high": hi, "low": lo, "close": rt(c[i]), "volume": int(v[i] or 0)})
            return out
        except Exception as ex:
            last_err = ex
    raise last_err

def utc(t): return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")

print(f"=== Yahoo daily update {datetime.datetime.now():%Y-%m-%d %H:%M:%S} ===", flush=True)

for sym, fname, tick in APPEND_1M:
    path = os.path.join(DATA, fname)
    try:
        existing = json.load(open(path)) if os.path.exists(path) else []
    except Exception:
        existing = []
    before = len(existing)
    try:
        fresh = fetch(sym, "1m", "8d", tick)
    except Exception as ex:
        print(f"  {sym:5} 1m -> {fname}: FETCH FAILED ({ex})", flush=True); continue
    by_t = {b["time"]: b for b in existing}
    added = sum(1 for b in fresh if b["time"] not in by_t)
    for b in fresh: by_t[b["time"]] = b                       # fresh wins on overlap (finalises the live bar)
    merged = [by_t[t] for t in sorted(by_t)]
    json.dump(merged, open(path, "w"))
    newest = utc(merged[-1]["time"]) if merged else "-"
    print(f"  {sym:5} 1m -> {fname}: +{added} new bars (total {before}->{len(merged)}), newest {newest} UTC", flush=True)

import subprocess
print("--- re-blending multi-res series (free, local — picks up today's 1m tail) ---", flush=True)
subprocess.run([sys.executable, os.path.join(HERE, "merge_multires.py")], check=False)

print("done", flush=True)
