import json
import os
import threading
import time
import uuid
from http import HTTPStatus
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

    def clear(self):
        with self._lock:
            self._captures = []

    def get(self, capture_id):
        with self._lock:
            for capture in self._captures:
                if capture["id"] == capture_id:
                    return dict(capture)
        return None


class DownloadStateStore:
    def __init__(self):
        self._records = {}
        self._lock = threading.Lock()

    def upsert(self, download_id, **changes):
        with self._lock:
            record = self._records.setdefault(
                download_id,
                {
                    "id": download_id,
                    "title": "Download",
                    "status": "queued",
                    "progress": 0,
                    "speed": "QUEUED",
                    "eta": "",
                    "save_path": "",
                    "completed_bytes": 0,
                    "error": "",
                    "url": "",
                    "created_at": int(time.time()),
                },
            )
            record.update(changes)
            return dict(record)

    def list(self):
        with self._lock:
            return sorted(self._records.values(), key=lambda item: item["created_at"], reverse=True)

    def clear_finished(self):
        with self._lock:
            self._records = {
                key: value
                for key, value in self._records.items()
                if value.get("status") == "active"
            }


def build_app_server(
    host,
    port,
    ui_dir,
    engine,
    get_settings,
    change_save_path,
    set_browser,
    open_file,
    open_folder,
    install_ffmpeg,
):
    captures = BrowserCaptureStore()
    downloads = DownloadStateStore()

    def json_response(handler, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        handler.send_response(status_code)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Cache-Control", "no-store")
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        handler.end_headers()
        handler.wfile.write(body)

    def read_json(handler):
        length = int(handler.headers.get("Content-Length", "0"))
        raw = handler.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def static_response(handler, relative_path):
        if relative_path in {"", "/"}:
            relative_path = "index.html"
        else:
            relative_path = relative_path.lstrip("/")

        normalized = os.path.normpath(relative_path)
        file_path = os.path.abspath(os.path.join(ui_dir, normalized))
        if not file_path.startswith(os.path.abspath(ui_dir)) or not os.path.exists(file_path):
            handler.send_error(HTTPStatus.NOT_FOUND)
            return

        with open(file_path, "rb") as file_obj:
            data = file_obj.read()

        content_type = "text/plain"
        if file_path.endswith(".html"):
            content_type = "text/html; charset=utf-8"
        elif file_path.endswith(".css"):
            content_type = "text/css; charset=utf-8"
        elif file_path.endswith(".js"):
            content_type = "application/javascript; charset=utf-8"
        elif file_path.endswith(".png"):
            content_type = "image/png"

        handler.send_response(HTTPStatus.OK)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(len(data)))
        handler.end_headers()
        handler.wfile.write(data)

    class Handler(BaseHTTPRequestHandler):
        def do_OPTIONS(self):
            json_response(self, 200, {"ok": True})

        def do_GET(self):
            if self.path == "/api/health":
                json_response(self, 200, {"ok": True})
                return
            if self.path == "/api/settings":
                json_response(self, 200, {"ok": True, "settings": get_settings()})
                return
            if self.path == "/api/downloads":
                json_response(self, 200, {"ok": True, "downloads": downloads.list()})
                return
            if self.path == "/api/captures":
                json_response(self, 200, {"ok": True, "captures": captures.list_captures()})
                return

            static_response(self, self.path)

        def do_POST(self):
            try:
                payload = read_json(self)
            except Exception:
                json_response(self, 400, {"ok": False, "error": "Invalid JSON body"})
                return

            if self.path == "/api/info":
                info = engine.get_info(payload.get("url", ""), browser=get_settings().get("browser"))
                if info is None:
                    json_response(self, 200, {"ok": False, "error": "Source could not be analyzed"})
                else:
                    json_response(self, 200, {"ok": True, "info": info})
                return

            if self.path == "/api/download":
                url = payload.get("url", "")
                format_id = payload.get("format_id", "best")
                title = payload.get("title", "Download")
                download_id = payload.get("download_id") or uuid.uuid4().hex[:10]
                downloads.upsert(download_id, title=title, url=url, status="queued", speed="QUEUED")
                engine.download(url, format_id=format_id, save_path=get_settings()["save_path"], browser=get_settings().get("browser"), download_id=download_id)
                json_response(self, 200, {"ok": True, "download_id": download_id})
                return

            if self.path == "/api/bulk_download":
                items = payload.get("items", [])
                quality = payload.get("quality", "best")
                format_map = {
                    "1080p": "bestvideo[height<=1080]",
                    "720p": "bestvideo[height<=720]",
                    "480p": "bestvideo[height<=480]",
                    "360p": "bestvideo[height<=360]",
                    "best": "best",
                    "audio": "audio",
                    "file": "direct",
                }
                format_id = format_map.get(quality, "best")
                for item in items:
                    download_id = item.get("id") or uuid.uuid4().hex[:10]
                    downloads.upsert(download_id, title=item.get("title", "Download"), url=item.get("url", ""), status="queued", speed="QUEUED")
                    engine.download(item.get("url", ""), format_id=format_id, save_path=get_settings()["save_path"], browser=get_settings().get("browser"), download_id=download_id)
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/cancel":
                download_id = payload.get("download_id")
                if download_id:
                    engine.cancel(download_id)
                    downloads.upsert(download_id, status="cancelled", speed="CANCELLED")
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/cancel_all":
                engine.cancel()
                for item in downloads.list():
                    if item.get("status") == "active":
                        downloads.upsert(item["id"], status="cancelled", speed="CANCELLED")
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/clear_dashboard":
                downloads.clear_finished()
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/capture":
                capture = captures.add_capture(payload)
                json_response(self, 200, {"ok": True, "capture": capture})
                return

            if self.path == "/api/captures/clear":
                captures.clear()
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/set_browser":
                set_browser(payload.get("browser", "None"))
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/open_file":
                open_file(payload.get("path", ""))
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/open_folder":
                open_folder(payload.get("path", ""))
                json_response(self, 200, {"ok": True})
                return

            if self.path == "/api/change_save_path":
                json_response(self, 200, {"ok": True, "path": change_save_path()})
                return

            if self.path == "/api/install_ffmpeg":
                threading.Thread(target=install_ffmpeg, daemon=True).start()
                json_response(self, 200, {"ok": True})
                return

            json_response(self, 404, {"ok": False, "error": "Not found"})

        def log_message(self, format, *args):
            return

    server = ThreadingHTTPServer((host, port), Handler)

    def start():
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        return server

    def progress_callback(download_id, progress, speed, eta):
        downloads.upsert(download_id, status="active", progress=progress, speed=speed, eta=eta)

    def completion_callback(download_id, file_path, file_size):
        downloads.upsert(
            download_id,
            status="completed",
            progress=1,
            speed="COMPLETED",
            eta="00:00",
            save_path=file_path,
            completed_bytes=file_size,
        )

    def error_callback(download_id, error):
        if download_id:
            downloads.upsert(download_id, status="error", speed="FAILED", error=str(error))

    return {
        "server": server,
        "start": start,
        "captures": captures,
        "downloads": downloads,
        "on_progress": progress_callback,
        "on_complete": completion_callback,
        "on_error": error_callback,
    }
