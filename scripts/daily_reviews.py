"""Daily refresh of the replay trainer's review lists: Mack's PATs (data/pats_reviews.json) and Thomas Wade (data/wade_reviews.json).
Local only: never runs git. One log line per run + indented details -> data/daily_reviews.log.

  py -3.12 scripts\\daily_reviews.py [--dry-run] [--only pats|wade]

PATs: scripts/pats_reviews.py --fetch (rebuilds the JSON; a title-date typo only shows up as a printed CHECK line -> logged, needs a human).
Wade (pipeline in D:\\PATs\\wade, override with env WADE_DIR for tests), incremental:
  channel list (yt-dlp flat) -> ids in neither results.jsonl nor videos.txt -> upload date + duration per new id
  -> keep those whose upload day is fully inside the ES 1m data (else they wait for a later run: a video past the data would be
  matched against nothing and burned as a permanent non-match) -> 3 frames each (wade_shots.mjs) -> es1m_cache.py
  -> append videos.txt / cand_ids.txt / cand_meta.txt -> run_all.py -> wade_reviews.py.
Lines are appended only after all frames exist, because run_all burns any id in cand_ids.txt that lacks frames.
Ids already in cand_ids/cand_meta but missing from results.jsonl (an interrupted earlier run) are picked up again.
A failure in one source does not stop the other; exit 1 only if every source that ran failed.
"""
import argparse, datetime as dt, importlib.util, json, os, re, shutil, subprocess, sys, tempfile, time, traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE.parent / 'data'
LOG = DATA / 'daily_reviews.log'
PATS_JSON, WADE_JSON = DATA / 'pats_reviews.json', DATA / 'wade_reviews.json'
WADE = Path(os.environ.get('WADE_DIR', r'D:\PATs\wade'))
CHANNEL = 'https://www.youtube.com/channel/UCRCw-YKaw3tMuP1lXDYsqig/videos'
FRACS = (0.3, 0.55, 0.8)        # same fractions as wade_date.py
MAX_NEW = 25                    # new Wade videos handled per run (rest wait; keeps one run well under the 1 h task limit)
MIN_FRAME = 8000                # bytes; a black / not-yet-playing frame is ~6 KB, real charts 50-250 KB

sys.dont_write_bytecode = True
os.environ['PYTHONUTF8'] = '1'  # children (yt-dlp, pats_reviews, wade scripts) print UTF-8
_scripts = Path(sys.executable).parent / 'Scripts'   # yt-dlp lives next to this Python; a scheduled task may not have it on PATH
if _scripts.is_dir():
    os.environ['PATH'] = f"{_scripts}{os.pathsep}{os.environ.get('PATH', '')}"
try: sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception: pass


def say(msg): print(msg, flush=True)


def run(cmd, timeout, cwd=None):
    t = time.time()
    r = subprocess.run([str(c) for c in cmd], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout, cwd=cwd)
    return r, time.time() - t


def tail(text, n=3): return ' / '.join([l for l in (text or '').strip().splitlines() if l.strip()][-n:])[:500]


def review_ids(path):
    """{video id: day} from a reviews json; {} if missing/unreadable"""
    try: days = json.load(open(path, encoding='utf-8'))['days']
    except Exception: return {}
    return {v['id']: day for day, vs in days.items() for v in vs}


def new_days(before, after):
    """(new video count, sorted days that gained a video)"""
    added = {i: d for i, d in after.items() if i not in before}
    return len(added), sorted(set(added.values()))


# ---------------------------------------------------------------- PATs
def pats(dry):
    before = review_ids(PATS_JSON)
    try: prev_log = LOG.read_text(encoding='utf-8', errors='replace')
    except OSError: prev_log = ''
    if dry:   # pats_reviews.py rebuilds its JSON on every run: import it and use fetch()/parse() without writing
        spec = importlib.util.spec_from_file_location('pats_reviews', HERE / 'pats_reviews.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        try: lines = m.fetch()
        except SystemExit as e: return dict(ok=False, summary=f'pats FAILED: {e}', details=[])
        days, fixed, warn = m.parse(lines)
        after = {v['id']: d for d, vs in days.items() for v in vs}
        det = [f'channel list {len(lines)} videos -> {len(after)} reviews on {len(days)} days (dry run, nothing written)']
        check = [f'CHECK {w}' for w in warn]
    else:
        r, secs = run([sys.executable, '-B', HERE / 'pats_reviews.py', '--fetch'], 1500)
        if r.returncode != 0 or ' reviews on ' not in r.stdout:
            return dict(ok=False, summary=f'pats FAILED (exit {r.returncode}): {tail(r.stderr or r.stdout)}', details=[tail(r.stdout + r.stderr, 8)])
        after = review_ids(PATS_JSON)
        out = r.stdout.splitlines()
        det = [f'updater ({secs:.0f}s): ' + next((l for l in out if ' reviews on ' in l), '')]
        det += [l for l in out if l.startswith(('year fixed', 'skip ')) and l not in prev_log]   # re-printed every build: log only when unseen
        check = [l for l in out if l.startswith('CHECK')]
    n, ds = new_days(before, after)
    gone = sorted({d for i, d in before.items() if i not in after})
    fresh = [c for c in check if c not in prev_log]   # CHECK lines are re-printed every build; only unseen ones need a human today
    for c in check: det.append(c + ('' if c in fresh else '   (already logged)'))
    if gone: det.append(f'WARNING: {len(gone)} review(s) disappeared vs previous json: {gone[:5]}')
    s = f'pats +{n} videos' + (f' on {len(ds)} days ({", ".join(ds)})' if n else '') + (f', CHECK {len(check)} ({len(fresh)} NEW)' if check else '')
    return dict(ok=True, summary=s, details=det)


# ---------------------------------------------------------------- Wade
def es_last_ts():
    """last ES bar (unix s) in what es1m_cache.py reads: the newest chunks/ES/20??-??.json and ES_db_1m.json (read from the file tails)"""
    files = [DATA / 'ES_db_1m.json'] + sorted((DATA / 'chunks' / 'ES').glob('20??-??.json'))[-1:]
    best = None
    for f in files:
        try:
            with open(f, 'rb') as fh:
                fh.seek(0, 2); fh.seek(max(0, fh.tell() - 65536)); tailtxt = fh.read().decode('ascii', 'ignore')
        except OSError: continue
        ts = [int(x) for x in re.findall(r'"time"\s*:\s*(\d+)', tailtxt)]
        if ts: best = max(best or 0, max(ts))
    return best


def utc(ts): return dt.datetime.fromtimestamp(ts, dt.timezone.utc)


def first_fields(path, sep='|', cr=False):
    try: lines = open(path, encoding='utf-8', errors='replace').read().splitlines()
    except OSError: return []
    return [l.strip().split('v=')[-1] if cr else l.split(sep, 1)[0] for l in lines if l.strip()]


def append_line(path, line, crlf=False):
    """append one line in the file's own newline style (cand_ids.txt is CRLF, the others LF)"""
    with open(path, 'ab') as f:
        f.write(line.replace('\r', ' ').replace('\n', ' ').encode('utf-8') + (b'\r\n' if crlf else b'\n'))


def jobs_for(vid, dur): return [(vid, int(max(5, float(dur) * f))) for f in FRACS]   # identical to wade_date.py


def frames_state(vid, dur):
    """(missing, small) frame paths for one video"""
    miss, small = [], []
    for _, t in jobs_for(vid, dur):
        p = WADE / 'frames' / f'{vid}_{t}.jpg'
        if not p.exists(): miss.append(p)
        elif p.stat().st_size < MIN_FRAME: small.append(p)
    return miss, small


def grab_frames(vids, node):
    """wade_shots.mjs for these videos; one retry for missing / blank frames. -> {id: (missing, small)}"""
    jobs = [j for vid, dur in vids for j in jobs_for(vid, dur)]
    jf = Path(tempfile.gettempdir()) / f'wade_jobs_{os.getpid()}.txt'
    state = {}
    for attempt in (1, 2):
        jf.write_text('\n'.join(f'{v} {t}' for v, t in jobs) + '\n', encoding='utf-8')
        r, secs = run([node, WADE / 'wade_shots.mjs', jf, WADE / 'frames', 3], 600 + 40 * len(jobs))
        state = {vid: frames_state(vid, dur) for vid, dur in vids}
        bad = [p for m, s in state.values() for p in m + s]
        if not bad or attempt == 2: break
        for p in bad:
            if p.exists(): p.unlink()   # blank frame: delete so wade_shots grabs it again
    jf.unlink(missing_ok=True)
    return state, tail(r.stdout)


def wade(dry):
    det = []
    res_ids = set()
    for l in open(WADE / 'results.jsonl', encoding='utf-8'):
        try: res_ids.add(json.loads(l)['id'])
        except (ValueError, KeyError): pass
    seen = set(first_fields(WADE / 'videos.txt'))
    meta = {}   # cand_meta.txt: id|upload|dur|title
    for l in open(WADE / 'cand_meta.txt', encoding='utf-8', errors='replace'):
        p = l.rstrip('\r\n').split('|', 3)
        if len(p) >= 3 and p[1].isdigit(): meta[p[0]] = p + [''] * (4 - len(p))
    cand = set(first_fields(WADE / 'cand_ids.txt', cr=True))
    r, _ = run(['yt-dlp', '--ignore-config', '--no-warnings', '--flat-playlist', '--print', '%(id)s|%(duration)s|%(title)s', CHANNEL], 600)
    flat = [l.split('|', 2) for l in r.stdout.splitlines() if l.count('|') >= 2]
    if r.returncode != 0 or len(flat) < 0.9 * len(seen):
        return dict(ok=False, summary=f'wade FAILED: channel list gave {len(flat)} videos (known {len(seen)}), yt-dlp exit {r.returncode}: {tail(r.stderr)}', details=[])
    new = [(i, t) for i, _, t in flat if i not in res_ids and i not in seen and i not in meta and i not in cand]
    capped = new[MAX_NEW:]; new = new[:MAX_NEW]
    # exact upload date + duration for the new ids
    info = {}
    for k in range(0, len(new), 10):
        chunk = [i for i, _ in new[k:k + 10]]
        rr, _ = run(['yt-dlp', '--ignore-config', '--no-warnings', '--ignore-errors', '--skip-download', '--print', '%(id)s|%(upload_date)s|%(duration)s|%(title)s',
                     *[f'https://www.youtube.com/watch?v={i}' for i in chunk]], 90 + 40 * len(chunk))
        for l in rr.stdout.splitlines():
            p = l.split('|', 3)
            if len(p) == 4 and p[0] in chunk and re.fullmatch(r'\d{8}', p[1]) and re.fullmatch(r'\d+(\.\d+)?', p[2]):
                info[p[0]] = (p[1], str(int(float(p[2]))), p[3].strip())
    es_ts = es_last_ts()
    queue, wait = [], []
    for i, t in new:
        if i not in info: wait.append(f'{i}  wait: no upload date / duration yet (live or premiere?)  {t[:60]}'); continue
        up, dur, title = info[i]
        cutoff = dt.datetime(int(up[:4]), int(up[4:6]), int(up[6:]), 21, tzinfo=dt.timezone.utc).timestamp()   # US session of the upload day must be in the data
        if es_ts is None or es_ts < cutoff:
            wait.append(f'{i}  wait: uploaded {up}, ES data ends {utc(es_ts):%Y-%m-%d %H:%M}Z  {title[:60]}' if es_ts else f'{i}  wait: ES data end unknown'); continue
        queue.append((i, up, dur, title))
    # ids a previous interrupted run already appended but never finished
    pending = sorted(i for i in meta if i not in res_ids)
    lost = [i for i in cand | set(meta) if i not in res_ids and i not in meta]
    for i, up, dur, title in queue: det.append(f'{i}  QUEUE  uploaded {up}  {int(dur)}s  {title[:70]}')
    for i in pending: det.append(f'{i}  PENDING (in cand files, no result yet)  {meta[i][3][:70] if len(meta[i]) > 3 else ""}')
    det += wait
    if capped: det.append(f'{len(capped)} more new video(s) beyond MAX_NEW={MAX_NEW}: next run')
    if lost: det.append(f'WARNING: ids in cand_ids but not in cand_meta (run_all would KeyError unless in videos.txt): {lost[:5]}')
    head = f'wade: channel {len(flat)}, new {len(new) + len(capped)}, queue {len(queue)}, pending {len(pending)}, waiting {len(wait)} (ES ends {utc(es_ts):%Y-%m-%d %H:%M}Z)' if es_ts else 'wade: ES end unknown'
    det.insert(0, head)
    todo = [(i, d) for i, _, d, _ in queue] + [(i, meta[i][2]) for i in pending]
    if not todo:
        return dict(ok=True, summary=f'wade +0 (waiting {len(wait)})', details=det)
    if dry:
        n = sum(len(jobs_for(i, d)) for i, d in todo)
        det.append(f'dry run: would grab {n} frames, rebuild es1m.npz, append {len(queue)} id(s) to videos.txt/cand_ids.txt/cand_meta.txt, run run_all.py + wade_reviews.py')
        return dict(ok=True, summary=f'wade would queue {len(queue)} (+{len(pending)} pending, waiting {len(wait)})', details=det)

    before = review_ids(WADE_JSON)
    node = shutil.which('node')
    if not node: return dict(ok=False, summary='wade FAILED: node not on PATH', details=det)
    state, shots_tail = grab_frames(todo, node)
    det.append('wade_shots: ' + shots_tail)
    blocked = [i for i, (m, s) in state.items() if m]
    for i in blocked: det.append(f'{i}  frames missing after retry -> not queued, tries again next run')
    stuck = [i for i in pending if i in blocked]   # already in cand_ids: run_all would burn it as 'download failed'
    if stuck: return dict(ok=False, summary=f'wade FAILED: pending ids without frames, run_all skipped to avoid burning them: {stuck}', details=det)
    for i, (m, s) in state.items():
        if s: det.append(f'{i}  warning: {len(s)} small frame(s) (blank player?)')
    queue = [q for q in queue if q[0] not in blocked]
    if not queue and not pending:
        return dict(ok=False, summary='wade FAILED: no frames could be grabbed', details=det)
    r, secs = run([sys.executable, WADE / 'es1m_cache.py'], 2400, cwd=WADE)
    det.append(f'es1m_cache ({secs:.0f}s): ' + tail(r.stdout, 1))
    if r.returncode != 0: return dict(ok=False, summary=f'wade FAILED es1m_cache: {tail(r.stderr)}', details=det)
    for i, up, dur, title in queue + [(i, meta[i][1], meta[i][2], meta[i][3]) for i in pending]:   # idempotent: fills only what is missing
        if i not in meta: append_line(WADE / 'cand_meta.txt', f'{i}|{up}|{dur}|{title}')
        if i not in seen: append_line(WADE / 'videos.txt', f'{i}|{dur}|{up}|{title}')
        if i not in cand: append_line(WADE / 'cand_ids.txt', f'https://www.youtube.com/watch?v={i}', crlf=True)
    r, secs = run([sys.executable, WADE / 'run_all.py'], 3000, cwd=WADE)
    det.append(f'run_all ({secs:.0f}s): ' + tail(r.stdout, 2))
    if r.returncode != 0 or 'finished' not in r.stdout: return dict(ok=False, summary=f'wade FAILED run_all (exit {r.returncode}): {tail(r.stderr or r.stdout)}', details=det)
    done = {}
    for l in open(WADE / 'results.jsonl', encoding='utf-8'):
        try: x = json.loads(l)
        except ValueError: continue
        done[x['id']] = x
    errs = []
    for i in [q[0] for q in queue] + pending:
        x = done.get(i)
        if x is None: errs.append(f'{i} missing from results.jsonl'); continue
        why = x.get('error') or ('; '.join(sorted({f.get('why', '') for f in x.get('frames', []) if f.get('why')})) if not x.get('day') else '')
        det.append(f"{i}  result day={x.get('day')}  {('(' + why + ')') if why else ''}")
        if 'error' in x: errs.append(f"{i} wade_date crashed (burned in results.jsonl; delete its line there to retry): {str(x['error'])[:150]}")
    r, secs = run([sys.executable, '-B', HERE / 'wade_reviews.py'], 300)
    det.append(f'wade_reviews ({secs:.0f}s): ' + tail(r.stdout, 1))
    if r.returncode != 0: return dict(ok=False, summary=f'wade FAILED wade_reviews: {tail(r.stderr)}', details=det)
    n, ds = new_days(before, review_ids(WADE_JSON))
    det += [f'ERROR {e}' for e in errs]
    s = f'wade +{n} videos' + (f' on {len(ds)} days ({", ".join(ds)})' if n else '') + f', processed {len(queue) + len(pending)}, waiting {len(wait)}'
    return dict(ok=not errs, summary=s + (f', {len(errs)} ERROR' if errs else ''), details=det)


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='list what would be added; write nothing (log, json, wade files)')
    ap.add_argument('--only', choices=('pats', 'wade'))
    a = ap.parse_args()
    t0 = time.time(); results = {}
    for name, fn in (('pats', pats), ('wade', wade)):
        if a.only and a.only != name: continue
        say(f'[{name}] start')
        try: results[name] = fn(a.dry_run)
        except Exception as e:
            results[name] = dict(ok=False, summary=f'{name} FAILED: {type(e).__name__}: {e}', details=traceback.format_exc().strip().splitlines()[-4:])
        say(f"[{name}] {'ok' if results[name]['ok'] else 'FAILED'}: {results[name]['summary']}")
    ok = [r['ok'] for r in results.values()]
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} | {'DRY ' if a.dry_run else ''}" + ' | '.join(r['summary'] for r in results.values()) + f' | {time.time() - t0:.0f}s | ' + ('OK' if all(ok) else 'PARTIAL' if any(ok) else 'FAILED')
    body = [f'    [{n}] {d}'.rstrip() for n, r in results.items() for d in r['details']]
    say(line); [say(b) for b in body]
    if not a.dry_run:
        with open(LOG, 'a', encoding='utf-8') as f: f.write(line + '\n' + ''.join(b + '\n' for b in body))
    return 0 if any(ok) else 1


if __name__ == '__main__':
    sys.exit(main())
