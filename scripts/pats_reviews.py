"""Mack's PATs Trading daily ES review videos -> data/pats_reviews.json ({"days": {"YYYY-MM-DD": [{id, t, d, k}]}}).
The replay trainer shows a PATs button on ES / MES days that have one and plays the video in a floating player.

Usage:
  py pats_reviews.py --fetch             # pull the channel list with yt-dlp (@PATsTrading, ~1 min), then build
  py pats_reviews.py <list.txt>          # build from a saved list: lines "id|duration|title[|upload_date]"
Titles: "<name> - Episode MMDDYY" (daily review, k=review) and "Live Student Trades - MM DD YYYY" (k=live).
"""
import sys, os, re, json, subprocess, datetime
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data', 'pats_reviews.json')
CHANNEL = 'https://www.youtube.com/@PATsTrading/videos'

def fetch():
    r = subprocess.run(['yt-dlp', '--ignore-config', '--flat-playlist', '--print', '%(id)s|%(duration)s|%(title)s', CHANNEL],
                       capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=900)
    lines = [l for l in r.stdout.splitlines() if l.count('|') >= 2]
    if len(lines) < 1000: sys.exit(f'yt-dlp returned only {len(lines)} videos: {r.stderr[-400:]}')
    return lines

def parse(lines):   # lines are newest-first (channel order)
    rows = []
    for l in lines:
        vid, dur, title = l.split('|', 3)[:3]
        m = re.search(r'Episode\s+(\d{2})(\d{2})(\d{2})\b', title)
        if m: mo, dd, yy, kind = int(m.group(1)), int(m.group(2)), 2000 + int(m.group(3)), 'review'
        else:
            m = re.search(r'Live Student Trades\s*-\s*(\d{1,2})\s+(\d{1,2})\s+(\d{4})', title)
            if not m: continue
            mo, dd, yy, kind = int(m.group(1)), int(m.group(2)), int(m.group(3)), 'live'
        name = re.sub(r'\s*-?\s*Episode\s+\d{6}\s*$', '', title).strip() or title
        rows.append({'id': vid, 'mo': mo, 'dd': dd, 'yy': yy, 'k': kind, 't': name, 'd': int(float(dur)) if dur not in ('', 'NA', 'None') else None, 'raw': title})
    today = datetime.date.today(); fixed = []
    for i, r in enumerate(rows):   # a typo'd year (e.g. "091029") -> take the year of the nearest neighbour in upload order
        try: day = datetime.date(r['yy'], r['mo'], r['dd'])
        except ValueError: print('skip bad date:', r['raw']); continue
        if day > today + datetime.timedelta(days=1):
            nb = [rows[j] for j in (i - 1, i + 1) if 0 <= j < len(rows) and rows[j]['yy'] <= today.year]
            if not nb: print('skip future date:', r['raw']); continue
            day = datetime.date(nb[0]['yy'], r['mo'], r['dd']); fixed.append(f"{r['raw']} -> {day}")
        r['day'] = day.isoformat()
    days = {}
    for r in rows:
        if 'day' in r: days.setdefault(r['day'], []).append({'id': r['id'], 't': r['t'], 'd': r['d'], 'k': r['k']})
    for v in days.values(): v.sort(key=lambda x: x['k'] != 'review')   # reviews first, live student trades after
    return days, fixed

if __name__ == '__main__':
    lines = fetch() if '--fetch' in sys.argv else open(sys.argv[1], encoding='utf-8').read().splitlines()
    days, fixed = parse(lines)
    out = {'built': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'channel': '@PATsTrading', 'days': dict(sorted(days.items()))}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    rev = sum(1 for v in days.values() for x in v if x['k'] == 'review'); live = sum(1 for v in days.values() for x in v if x['k'] == 'live')
    k = sorted(days)
    print(f'{len(lines)} channel videos -> {len(days)} days ({rev} reviews, {live} live student trades), {k[0]}..{k[-1]} -> {os.path.normpath(OUT)} ({os.path.getsize(OUT) // 1024} KB)')
    for f in fixed: print('year fixed:', f)
