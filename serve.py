"""Tiny static server for the Replay Trainer. Silences request logging so it runs cleanly
under pyw.exe (window-less, no console -> writing logs to stderr would crash each request)."""
import http.server, socketserver, os

DIR = os.path.dirname(os.path.abspath(__file__))   # serve the app from wherever this script lives (move-proof)
# Windows reserves random port blocks for Hyper-V/WinNAT after some reboots — on 2026-08-26 the whole
# 5522-5921 range was excluded and binding 5560 raised WinError 10013. Try the canonical port first
# (bookmarks point there), then a fallback BELOW the volatile 55xx block.
PORTS = [5560, 5460]

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)
    def log_message(self, *a):
        pass  # no console under pyw -> don't touch stderr

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
