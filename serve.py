"""Tiny static server for the Replay Trainer. Silences request logging so it runs cleanly
under pyw.exe (window-less, no console -> writing logs to stderr would crash each request).

Also: /api/clip cuts a YouTube review-video clip for the chart (Mack's PATs / Thomas Wade) with the
yt-clip tool's CLI (D:/Tools/yt-clip/ytclip.py --json: yt-dlp whole video to its cache under a cross-process
lock -> ffmpeg exact cut) into data/clips/<videoId>_<in>_<out>.mp4. That file name is the cache key: a clip is
cut once, ever (written as .part.mp4 and renamed when complete, so a half-written file is never served).
  POST /api/clip {"vid": "...", "a": seconds, "b": seconds} -> {"key", "state": done|running|error, "pct", "url"}
  GET  /api/clip?key=...                                   -> same, for polling
.mp4 files are served with HTTP Range (206) so the <video> scrubber can seek."""
import http.server, socketserver, os, sys, json, re, threading, subprocess, urllib.parse, urllib.request

DIR = os.path.dirname(os.path.abspath(__file__))   # serve the app from wherever this script lives (move-proof)
# Windows reserves random port blocks for Hyper-V/WinNAT after some reboots — on 2026-08-26 the whole
# 5522-5921 range was excluded and binding 5560 raised WinError 10013. Try the canonical port first
# (bookmarks point there), then a fallback BELOW the volatile 55xx block.
PORTS = [5560, 5460]
CLIPS = os.path.join(DIR, 'data', 'clips')
YTCLIP = r'D:\Tools\yt-clip\ytclip.py'
PY = os.path.join(os.path.dirname(sys.executable), 'python.exe')   # the console twin of the pythonw running us (the child gets no window anyway)
VID = re.compile(r'[A-Za-z0-9_-]{11}')   # used with fullmatch: no trailing newline, ASCII only
KEY = re.compile(r'[A-Za-z0-9_-]{11}_[0-9]+\.[0-9]_[0-9]+\.[0-9]')
MAX_LEN = 600   # seconds per clip
_jobs, _guard = {}, threading.Lock()   # key -> {"state", "pct", "err"}


def clip_key(vid, a, b):
    return f'{vid}_{a:.1f}_{b:.1f}'


_info = {}   # vid -> {"vid", "duration", "spec"}: the clip editor's storyboard thumbnails + length (from the watch page, ~1 s)
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'
SB = re.compile(r'"playerStoryboardSpecRenderer":\{"spec":"((?:[^"\\]|\\.)*)"')


def yt_info(vid):
    if vid in _info:
        return _info[vid]
    rq = urllib.request.Request(f'https://www.youtube.com/watch?v={vid}&hl=en', headers={'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
    html = urllib.request.urlopen(rq, timeout=15).read().decode('utf-8', 'replace')
    m, d = SB.search(html), re.search(r'"lengthSeconds":"(\d+)"', html)
    out = {'vid': vid, 'duration': int(d.group(1)) if d else None, 'spec': json.loads('"' + m.group(1) + '"') if m else None}
    if out['spec'] or out['duration']:
        _info[vid] = out
    return out


def clip_list(vid):   # the clips already cut from this video (the editor's tray)
    out = []
    try:
        names = os.listdir(CLIPS)
    except OSError:
        return out
    for n in names:
        m = re.match(r'^' + re.escape(vid) + r'_(\d+\.\d)_(\d+\.\d)\.mp4$', n)
        if m:
            out.append({'a': float(m[1]), 'b': float(m[2]), 'url': f'data/clips/{n}'})
    for k, j in list(_jobs.items()):   # still being cut (the cut goes on after the page is closed): the tray shows it with its progress
        m = re.match(r'^' + re.escape(vid) + r'_(\d+\.\d)_(\d+\.\d)$', k)
        if m and j.get('state') == 'running':
            out.append({'a': float(m[1]), 'b': float(m[2]), 'state': 'running', 'pct': j.get('pct', 0)})
    return sorted(out, key=lambda c: c['a'])


def clip_status(key):
    j = _jobs.get(key)
    if j:
        return {'key': key, **j}
    if os.path.isfile(os.path.join(CLIPS, key + '.mp4')):
        return {'key': key, 'state': 'done', 'pct': 100, 'url': f'data/clips/{key}.mp4'}
    return {'key': key, 'state': 'none', 'pct': 0}


def clip_job(vid, a, b, key):   # yt-clip CLI contract: one JSON event per stdout line (log / progress pct 0-1 / done paths / error), exit 0 = ok
    part = os.path.join(CLIPS, key + '.part.mp4')
    err = ''
    try:
        os.makedirs(CLIPS, exist_ok=True)
        cmd = [PY if os.path.isfile(PY) else sys.executable, YTCLIP, f'https://www.youtube.com/watch?v={vid}', f'{a}-{b}',
               '--out', CLIPS, '--name', key + '.part.mp4', '--json']
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        for raw in p.stdout:
            try:
                ev = json.loads(raw.decode('utf-8', 'replace'))
            except ValueError:
                continue
            if ev.get('event') == 'progress':
                _jobs[key]['pct'] = max(_jobs[key]['pct'], min(99, round(float(ev.get('pct') or 0) * 100)))
            elif ev.get('event') == 'error':
                err = str(ev.get('error') or '')
        rc = p.wait()
        if rc == 0 and os.path.isfile(part):
            os.replace(part, os.path.join(CLIPS, key + '.mp4'))
            _jobs.pop(key, None)
            return
        _jobs[key] = {'state': 'error', 'pct': 0, 'err': (err or f'yt-clip exit {rc}')[:300]}
    except Exception as e:   # noqa: BLE001 - report anything to the page
        _jobs[key] = {'state': 'error', 'pct': 0, 'err': str(e)[:300] or e.__class__.__name__}
    finally:
        if os.path.isfile(part):
            try:
                os.remove(part)
            except OSError:
                pass


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)

    def log_message(self, *a):
        pass  # no console under pyw -> don't touch stderr

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):   # only this app may start downloads (a POST from any other site in the browser is refused)
        o = self.headers.get('Origin')
        if not o:
            return True
        u = urllib.parse.urlparse(o)
        return u.hostname in ('127.0.0.1', 'localhost') and u.port == self.server.server_address[1]

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path == '/api/clip':
            key = (urllib.parse.parse_qs(u.query).get('key') or [''])[0]
            if not KEY.fullmatch(key):
                return self._json(400, {'error': 'bad key'})
            return self._json(200, clip_status(key))
        if u.path in ('/api/ytinfo', '/api/clips'):
            vid = (urllib.parse.parse_qs(u.query).get('vid') or [''])[0]
            if not VID.fullmatch(vid):
                return self._json(400, {'error': 'bad vid'})
            if u.path == '/api/clips':
                return self._json(200, {'vid': vid, 'clips': clip_list(vid)})
            try:
                return self._json(200, yt_info(vid))
            except Exception as e:   # noqa: BLE001 - offline / YouTube changed: the editor still works without thumbnails
                return self._json(200, {'vid': vid, 'error': str(e)[:200]})
        return super().do_GET()

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        if u.path != '/api/clip':
            return self._json(404, {'error': 'not found'})
        if not self._same_origin():
            return self._json(403, {'error': 'origin'})
        try:
            n = int(self.headers.get('Content-Length') or 0)
            req = json.loads(self.rfile.read(min(n, 4096)) or b'{}')
            vid, a, b = str(req.get('vid', '')), round(float(req.get('a')), 1), round(float(req.get('b')), 1)
        except Exception:   # noqa: BLE001
            return self._json(400, {'error': 'bad request'})
        if not VID.fullmatch(vid) or not (0 <= a < b):
            return self._json(400, {'error': 'bad clip'})
        if b - a > MAX_LEN + 1e-6:   # (600.0 s from tenths subtracts with float noise)
            return self._json(400, {'error': 'too long'})
        key = clip_key(vid, a, b)
        with _guard:
            st = clip_status(key)
            if st['state'] in ('none', 'error'):
                _jobs[key] = {'state': 'running', 'pct': 0}
                threading.Thread(target=clip_job, args=(vid, a, b, key), daemon=True).start()
                st = clip_status(key)
        return self._json(200, st)

    # ---- HTTP Range for video (SimpleHTTPRequestHandler always sends the whole file) ----
    def send_head(self):
        rng = self.headers.get('Range')
        path = self.translate_path(urllib.parse.urlparse(self.path).path)
        if not rng or not path.lower().endswith('.mp4') or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
        size = os.path.getsize(path)
        if not m or (m[1] == '' and m[2] == ''):
            return super().send_head()
        if m[1] == '':
            start, end = max(0, size - int(m[2])), size - 1
        else:
            start, end = int(m[1]), min(size - 1, int(m[2]) if m[2] else size - 1)
        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return None
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', 'video/mp4')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self._left = end - start + 1
        return f

    def copyfile(self, source, outputfile):
        left = getattr(self, '_left', None)
        if left is None:
            return super().copyfile(source, outputfile)
        self._left = None
        while left > 0:
            buf = source.read(min(65536, left))
            if not buf:
                break
            outputfile.write(buf)
            left -= len(buf)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    for port in PORTS:
        try:
            srv = Server(("127.0.0.1", port), Handler)
            break
        except OSError:
            srv = None      # reserved/占用 -> try the next one
    if srv:
        srv.serve_forever()
