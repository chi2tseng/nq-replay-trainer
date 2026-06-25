"""Fetch REAL CME futures bars from Yahoo Finance -> data/<out>.json (app format).
Yahoo caps 1m at ~8 days and 5m at 60 days; futures cover the full ~23h Globex session.
Usage: python fetch_real.py <yahoo_sym> <tick> <interval> <range> <out.json>
"""
import json, os, sys, datetime, urllib.request, urllib.parse
HERE=os.path.dirname(os.path.abspath(__file__)); DATA=os.path.join(HERE,"..","data")
SYM,TICK,INTERVAL,RANGE,OUT = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
url=f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(SYM)}?range={RANGE}&interval={INTERVAL}"
req=urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
d=json.load(urllib.request.urlopen(req,timeout=40))
r=d["chart"]["result"][0]; ts=r["timestamp"]; q=r["indicators"]["quote"][0]
o,h,l,c,v=q["open"],q["high"],q["low"],q["close"],q["volume"]
rt=lambda x: round(round(x/TICK)*TICK,2)
bars=[]
for i,t in enumerate(ts):
    if o[i] is None or h[i] is None or l[i] is None or c[i] is None: continue
    hi=rt(max(h[i],o[i],c[i])); lo=rt(min(l[i],o[i],c[i]))
    bars.append({"time":int(t),"open":rt(o[i]),"high":hi,"low":lo,"close":rt(c[i]),"volume":int(v[i] or 0)})
# dedup by time (Yahoo can repeat the live bar), keep last
seen={}; 
for b in bars: seen[b["time"]]=b
bars=[seen[t] for t in sorted(seen)]
out=os.path.join(DATA,OUT)
json.dump(bars, open(out,"w"))
# quick quality report
n=len(bars); flat=sum(1 for b in bars if b["open"]==b["high"]==b["low"]==b["close"])
zv=sum(1 for b in bars if b["volume"]==0)
f0=datetime.datetime.utcfromtimestamp(bars[0]["time"]); f1=datetime.datetime.utcfromtimestamp(bars[-1]["time"])
print(f"{OUT}: {n} bars  {f0}..{f1}  px {min(b['low'] for b in bars)}..{max(b['high'] for b in bars)}  flat={flat} zeroVol={zv}")
