"""Databento metadata probe (FREE — no data egress charge).
Tells you cost / record-count / billable-size for a query BEFORE downloading.
Key from env DB_KEY (never committed).
Usage: python db_meta.py <schema> <start> <end> [symbol]
  e.g. python db_meta.py trades 2026-03-26 2026-06-26 NQ.v.0
"""
import sys, os, base64, urllib.request, urllib.parse

KEY = os.environ["DB_KEY"]
schema, start, end = sys.argv[1], sys.argv[2], sys.argv[3]
sym = sys.argv[4] if len(sys.argv) > 4 else "NQ.v.0"
base = {"dataset": "GLBX.MDP3", "symbols": sym, "schema": schema, "stype_in": "continuous", "start": start, "end": end}

def call(ep, extra=None):
    p = dict(base); p.update(extra or {})
    url = "https://hist.databento.com/v0/" + ep + "?" + urllib.parse.urlencode(p)
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Basic " + base64.b64encode((KEY + ":").encode()).decode())
    return urllib.request.urlopen(req, timeout=180).read().decode().strip()

cost = float(call("metadata.get_cost", {"mode": "historical"}))
recs = int(call("metadata.get_record_count"))
size = int(call("metadata.get_billable_size"))
print(f"schema={schema}  {start}..{end}  {sym}")
print(f"  cost        = ${cost:,.2f}")
print(f"  records     = {recs:,}")
print(f"  raw size    = {size/1e9:,.2f} GB ({size:,} bytes)")
