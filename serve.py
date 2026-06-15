"""Tiny static server for the Replay Trainer. Silences request logging so it runs cleanly
under pyw.exe (window-less, no console -> writing logs to stderr would crash each request)."""
import http.server, socketserver

DIR = r"C:\Users\chi2t\Downloads\replay-trainer"
PORT = 5560

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=DIR, **k)
    def log_message(self, *a):
        pass  # no console under pyw -> don't touch stderr

class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

if __name__ == "__main__":
    Server(("127.0.0.1", PORT), Handler).serve_forever()
