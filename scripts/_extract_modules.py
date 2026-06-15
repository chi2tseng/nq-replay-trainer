import json, os, re, html
SRC = r"C:\Users\chi2t\AppData\Local\Temp\claude\C--Users-chi2t-Downloads\eb6e89dd-60d7-4558-9476-b480c16e1ca6\tasks\wy2vm25p1.output"
OUT = r"C:\Users\chi2t\Downloads\_rt_modules"
raw = open(SRC, encoding="utf-8").read()
data = None
try:
    data = json.loads(raw)
except Exception:
    m = re.search(r'\{"generated"', raw)
    if m:
        data, _ = json.JSONDecoder().raw_decode(raw[m.start():])
if data is None:
    raise SystemExit("could not parse JSON; first 200 chars:\n" + raw[:200])
mods = data.get("modules") or data.get("result", {}).get("modules")
os.makedirs(OUT, exist_ok=True)
print(f"{len(mods)} modules:")
for mod in mods:
    k = mod["key"]
    for field, ext in (("code", "code.js"), ("css", "css"), ("wiring", "wiring.md")):
        v = mod.get(field, "") or ""
        # the live JSON should hold real chars; unescape only if it clearly contains entities
        if "&gt;" in v or "&lt;" in v or "&amp;" in v:
            v = html.unescape(v)
        open(os.path.join(OUT, f"{k}.{ext}"), "w", encoding="utf-8").write(v)
    print(f"  {k:18} code={len(mod.get('code','') or ''):6}  css={len(mod.get('css','') or ''):6}  wiring={len(mod.get('wiring','') or ''):5}")
