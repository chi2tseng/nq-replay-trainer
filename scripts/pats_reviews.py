"""Mack's PATs Trading daily ES review videos -> data/pats_reviews.json ({"days": {"YYYY-MM-DD": [{id, t, d}]}}).
The replay trainer shows a PATs button on ES / MES days that have one and plays the video in a floating player.

Usage:
  py pats_reviews.py --fetch             # pull the channel list with yt-dlp (@PATsTrading, ~1 min), then build
  py pats_reviews.py <list.txt>          # build from a saved list: lines "id|duration|title[|upload_date]", newest first

The title carries the trading day ("<name> - Episode MMDDYY" and ~10 other spellings). Mack sometimes mistypes it, so
OVERRIDES pins the videos whose upload date / content proved a different day (verified 2026-10-04 against yt-dlp
upload dates and the ES session that matches the title wording). Each build also prints any title date that breaks the
channel's upload order or lands on a weekend: that is how a new typo shows up — check it and add it to OVERRIDES.
Live-student / trade-example videos are not daily reviews and are skipped.
"""
import sys, os, re, json, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'pats_reviews.json')
CHANNEL = 'https://www.youtube.com/@PATsTrading/videos'
OVERRIDES = {   # id -> real trading day (title typo); evidence: upload date + session wording
    '1ZmQ2P_CJAA': '2022-02-07', 't32qFB2z_Sk': '2022-03-09', 'OOdy8bMX7xg': '2025-05-21', 'nyu2k_6_xGI': '2024-01-16',
    'Sh0NqsK3Mh8': '2023-09-05', 'ecdoEqqR2LE': '2025-03-18', 'suT0qq43SWw': '2026-01-06', 'PbH6CxNuzv8': '2025-09-18',
    'rDAjp9toLRw': '2025-05-06', 'iZgAGnfHZZ8': '2025-10-15', 'otYE3-_Onic': '2025-11-03', 'qdMJLtsLwNw': '2026-09-01',
    'SPVS3FB645A': '2023-10-12',   # title has no date at all
}
MIN_DAY = datetime.date(2020, 10, 1)   # the daily 'Episode' series starts 2020-10-21; older uploads are lessons with dates (and typo years like 1017)
SKIP = re.compile(r'\blive\b|student|example', re.I)
EP = r'(?:episode|episdoe|espisode|epidsode)'
WITH_WORD = [   # (regex, group order) tried in order; 8-digit before 6-digit so 01062021 is not read as 01-06-20
    (re.compile(EP + r'\s*-?\s*(\d{2})(\d{2})(\d{4})(?!\d)', re.I), 'mdy'),
    (re.compile(EP + r'\s*-?\s*(\d{2})(\d{2})(\d{2})(?!\d)', re.I), 'mdy'),
    (re.compile(EP + r'\s*-?\s*(\d{1,2})[ -](\d{1,2})[ -](\d{2,4})(?!\d)', re.I), 'mdy'),
]
AT_END = [   # no "Episode" word: the date closes the title
    re.compile(r'(\d{2})(\d{2})(\d{4})\s*$'),
    re.compile(r'(?:^|[\s-])(\d{2})(\d{2})(\d{2})\s*$'),
    re.compile(r'(?:^|[\s-])(\d{1,2})[ -](\d{1,2})[ -](\d{4})\s*$'),
]

def fetch():
    r = subprocess.run(['yt-dlp', '--ignore-config', '--flat-playlist', '--print', '%(id)s|%(duration)s|%(title)s', CHANNEL],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    lines = [l for l in r.stdout.splitlines() if l.count('|') >= 2]
    if len(lines) < 1000: sys.exit(f'yt-dlp returned only {len(lines)} videos: {r.stderr[-400:]}')
    return lines

def title_date(title):
    for rx, _ in WITH_WORD:
        m = rx.search(title)
        if m: return m
    for rx in AT_END:
        m = rx.search(title)
        if m: return m
    return None

def mkdate(m):
    mo, dd, yy = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if yy < 100: yy += 2000
    return datetime.date(yy, mo, dd)

def clean_name(title, m):
    name = (title[:m.start()] + title[m.end():]) if m else title
    name = re.sub(EP + r'\s*$', '', name.strip(), flags=re.I)
    return name.strip(' -') or title

def parse(lines):   # lines are newest-first (channel order)
    rows, today = [], datetime.date.today()
    for l in lines:
        vid, dur, title = l.split('|', 3)[:3]
        if SKIP.search(title) and vid not in OVERRIDES: continue
        m = title_date(title)
        if vid in OVERRIDES: day, how = datetime.date.fromisoformat(OVERRIDES[vid]), 'override'
        elif m:
            try: day, how = mkdate(m), 'title'
            except ValueError: print('skip bad date:', title); continue
        else: continue
        rows.append({'id': vid, 'day': day, 'how': how, 't': clean_name(title, m), 'd': int(float(dur)) if dur not in ('', 'NA', 'None') else None, 'raw': title})
    fixed = []
    for i, r in enumerate(rows):   # a year in the future ("091029") -> the year of the nearest neighbour in upload order
        if r['how'] == 'title' and r['day'] > today + datetime.timedelta(days=1):
            nb = [rows[j]['day'] for j in (i - 1, i + 1) if 0 <= j < len(rows) and rows[j]['day'] <= today]
            if not nb: print('skip future date:', r['raw']); r['day'] = None; continue
            r['day'] = r['day'].replace(year=nb[0].year); fixed.append(f"{r['raw']} -> {r['day']}")
    rows = [r for r in rows if r['day'] and r['day'] >= MIN_DAY]
    warn = []
    for i, r in enumerate(rows):   # upload order is newest first: a title date newer than the video uploaded after it is a typo suspect
        if r['day'].weekday() >= 5: warn.append(f"weekend  {r['day']}  {r['id']}  {r['raw']}")
        if i > 0 and r['day'] > rows[i - 1]['day'] and r['how'] == 'title': warn.append(f"order    {r['day']} listed after {rows[i - 1]['day']}  {r['id']}  {r['raw']}")
    days = {}
    for r in rows: days.setdefault(r['day'].isoformat(), []).append({'id': r['id'], 't': r['t'], 'd': r['d']})
    return days, fixed, warn

if __name__ == '__main__':
    lines = fetch() if '--fetch' in sys.argv else open(sys.argv[1], encoding='utf-8').read().splitlines()
    days, fixed, warn = parse(lines)
    out = {'built': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'channel': '@PATsTrading', 'days': dict(sorted(days.items()))}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    k = sorted(days); n = sum(len(v) for v in days.values())
    print(f'{len(lines)} channel videos -> {n} reviews on {len(days)} days, {k[0]}..{k[-1]} -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)')
    for f in fixed: print('year fixed:', f)
    multi = [d for d, v in days.items() if len(v) > 1]
    if multi: print('days with 2+ videos (check):', ', '.join(multi))
    for w in warn: print('CHECK', w)
