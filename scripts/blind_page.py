"""Blind-test page: charts go in as plain data, outcomes base64-encoded (not readable at a glance in the page source).
Usage: py blind_page.py <blind_data.json> <out.html>"""
import sys, os, json, base64
HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(sys.argv[1], encoding='utf-8'))
charts = [{k: t[k] for k in ('k', 'side', 'stop', 'sigTime', 'bars', 'tod', 'brk', 'ema')} for t in d['trades']]
outs = {t['k']: {k: t[k] for k in ('date', 'entryTime', 'month', 'trig', 'act', 'std')} for t in d['trades']}
meta = {'stdTp': d['stdTp'], 'files': d['files'], 'built': d['built'], 'prior': d['prior']}
page = open(os.path.join(HERE, 'blind_template.html'), encoding='utf-8').read()
page = page.replace('__CHARTS__', json.dumps(charts, separators=(',', ':'))).replace('__META__', json.dumps(meta, ensure_ascii=False)) \
           .replace('__OUTCOMES_B64__', base64.b64encode(json.dumps(outs, separators=(',', ':')).encode()).decode())
os.makedirs(os.path.dirname(os.path.abspath(sys.argv[2])), exist_ok=True)
open(sys.argv[2], 'w', encoding='utf-8').write(page)
print(f"{len(charts)} charts -> {sys.argv[2]} ({os.path.getsize(sys.argv[2]) // 1024} KB)")
