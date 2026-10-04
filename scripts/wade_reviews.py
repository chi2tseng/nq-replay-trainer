"""Thomas Wade videos -> data/wade_reviews.json ({"days": {"YYYY-MM-DD": [{id, t, d, err, n}]}}) for the replay trainer's Wade button.

Wade's titles carry no date and he uploads days to weeks after the session, so each video is dated by matching the
NinjaTrader chart in 3 of its frames to ES 1-minute data (D:/PATs/wade/wade_date.py, batch: run_all.py -> results.jsonl).
Ground truth (5 dated titles: 2024-05-21, 2025-09-19, 2025-09-24, 2026-01-05, 2026-09-04) all recovered, and an independent
re-check of 20 kept videos (own candle extraction vs ES 1m, neighbouring days and timezones as alternatives) found 20/20 right
(2026-10-04). Only confident matches are kept:
  a frame counts when its best fit is within 1.0 pt (median candle-mid error) and beats the best other day by 2x;
  keep a video when 2+ such frames agree, or 1 frame within 0.8 pt that beats the runner-up by 2.5x and no frame disagrees.
Usage: py wade_reviews.py [D:/PATs/wade/results.jsonl]
"""
import sys, os, json, datetime
SRC = sys.argv[1] if len(sys.argv) > 1 else r'D:\PATs\wade\results.jsonl'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'wade_reviews.json')
days, kept, skipped, why = {}, 0, 0, {}
for line in open(SRC, encoding='utf-8'):
    r = json.loads(line)
    good = [f for f in r.get('frames', []) if f.get('tday') and f['err'] <= 1.0 and f['ratio'] >= 2.0]
    votes = {}
    for f in good: votes[f['tday']] = votes.get(f['tday'], 0) + 1
    day = None
    if votes:
        best = max(votes, key=votes.get)
        if votes[best] >= 2 and votes[best] > len(good) / 2: day = best
        elif len(votes) == 1 and any(f['err'] <= 0.8 and f['ratio'] >= 2.5 for f in good): day = best
    if not day:
        skipped += 1; k = 'no clean chart match' if not good else 'frames disagree / weak'; why[k] = why.get(k, 0) + 1; continue
    errs = [f['err'] for f in good if f['tday'] == day]
    days.setdefault(day, []).append({'id': r['id'], 't': r.get('title', ''), 'd': int(float(r['dur'])) if r.get('dur') else None, 'err': round(min(errs), 2), 'n': len(errs)})
    kept += 1
for v in days.values(): v.sort(key=lambda x: (-x['n'], x['err']))
json.dump({'built': datetime.datetime.now().strftime('%Y-%m-%d %H:%M'), 'channel': 'Thomas Wade (UCRCw-YKaw3tMuP1lXDYsqig)', 'method': 'chart-matched to ES 1m', 'days': dict(sorted(days.items()))},
          open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(f'{kept} videos dated on {len(days)} days, {skipped} skipped {why} -> {os.path.normpath(OUT)}')
