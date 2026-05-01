import json
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class BrowserCaptureStore:
    def __init__(self):
        self._captures = []
        self._lock = threading.Lock()

    def add_capture(self, payload):
        capture = {
            "id": uuid.uuid4().hex[:10],
            "url": payload.get("url", ""),
            "title": payload.get("title", "Browser Capture"),
            "media_url": payload.get("media_url", ""),
            "page_url": payload.get("page_url", ""),
            "kind": payload.get("kind", "page"),
            "source": payload.get("source", "browser_extension"),
            "created_at": int(time.time()),
        }

        if not capture["url"]:
            capture["url"] = capture["media_url"] or capture["page_url"]

        if not capture["page_url"]:
            capture["page_url"] = capture["url"]

        if capture["media_url"].startswith(("blob:", "mediastream:")):
            capture["media_url"] = ""
            capture["url"] = capture["page_url"]
            if capture["kind"] in {"video", "audio"}:
                capture["kind"] = "browser"

        with self._lock:
            self._captures.insert(0, capture)
            self._captures = self._captures[:100]

        return capture

    def list_captures(self):
        with self._lock:
            return list(self._captures)

    def clear_captures(self):
        with self._lock:
            self._captures = []

    def get_capture(self, capture_id):
        with self._lock:
            for capture in self._captures:
                if capture["id"] == capture_id:
                    return dict(capture)
        return None


def start_browser_bridge(store, on_capture=None, host="127.0.0.1", port=38945):
    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, status_code, payload):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self._send_json(200, {"ok": True})

        def do_GET(self):
            if self.path == "/health":
                self._send_json(200, {"ok": True, "service": "fetchora-browser-bridge"})
                return

            if self.path == "/captures":
                self._send_json(200, {"ok": True, "captures": store.list_captures()})
                return

            self._send_json(404, {"ok": False, "error": "Not found"})

        def do_POST(self):
            if self.path == "/capture":
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    raw_body = self.rfile.read(length) if length else b"{}"
                    payload = json.loads(raw_body.decode("utf-8"))
                except Exception:
                    self._send_json(400, {"ok": False, "error": "Invalid JSON body"})
                    return

                capture = store.add_capture(payload)
                if on_capture:
                    on_capture(capture)
                self._send_json(200, {"ok": True, "capture": capture})
                return

            if self.path == "/captures/clear":
                store.clear_captures()
                self._send_json(200, {"ok": True})
                return

            self._send_json(404, {"ok": False, "error": "Not found"})

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer((host, port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server
