"""Static server for build/ that disables caching, so a rebuild shows up on a
plain reload (python -m http.server lets the browser keep lba1.data/wasm)."""
import functools
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
handler = functools.partial(NoCache, directory='build')
http.server.ThreadingHTTPServer(('localhost', port), handler).serve_forever()
