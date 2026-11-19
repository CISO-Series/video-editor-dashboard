"""Local preview: serves apps-script/Index.html with the mock backend injected.

    python3 preview/serve.py   ->  http://localhost:8120
"""
import http.server
import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
INDEX = ROOT.parent / "apps-script" / "Index.html"
PORT = int(os.environ.get("PORT", 8120))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def do_GET(self):
        if self.path.split("?")[0] in ("/", "/index.html"):
            html = INDEX.read_text(encoding="utf-8")
            html = html.replace("<head>", '<head>\n<script src="/mock.js"></script>', 1)
            html = html.replace("<?!= JSON.stringify(userEmail) ?>", '"preview@localhost"')
            body = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    print(f"Video Editor Dashboard preview on http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
