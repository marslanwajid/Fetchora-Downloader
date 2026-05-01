import os
import shutil
import sys
import tkinter as tk
from tkinter import filedialog

from PySide6.QtCore import QUrl
from PySide6.QtWidgets import QApplication, QMainWindow
from PySide6.QtWebEngineWidgets import QWebEngineView

from app_server import build_app_server
from engine import YTDLEngine


APP_NAME = "FETCHORA"
HOST = "127.0.0.1"
PORT = 38945
SAVE_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "FETCHORA_Downloads")
BROWSER = "None"
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
RUNTIME_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
UI_DIR = os.path.join(BASE_DIR, "ui")


engine = YTDLEngine()


def set_browser(browser_name):
    global BROWSER
    BROWSER = browser_name


def open_file(path):
    if os.path.exists(path):
        os.startfile(path)


def open_folder(path):
    folder = os.path.dirname(path) if os.path.isfile(path) else path
    if os.path.exists(folder):
        os.startfile(folder)


def change_save_path():
    root = tk.Tk()
    root.withdraw()
    path = filedialog.askdirectory()
    root.destroy()
    if path:
        global SAVE_DIR
        SAVE_DIR = path
        return path
    return None


def get_settings():
    bundled_ffmpeg = os.path.exists(os.path.join(BASE_DIR, "ffmpeg.exe"))
    local_ffmpeg = os.path.exists(os.path.join(RUNTIME_DIR, "ffmpeg.exe"))
    has_ffmpeg = bool(shutil.which("ffmpeg") or bundled_ffmpeg or local_ffmpeg)
    return {
        "app_name": APP_NAME,
        "save_path": SAVE_DIR,
        "has_ffmpeg": has_ffmpeg,
        "ffmpeg_mode": "bundled" if bundled_ffmpeg else ("local" if local_ffmpeg else ("system" if shutil.which("ffmpeg") else "missing")),
        "browser": BROWSER,
        "bridge_port": PORT,
    }


def install_ffmpeg_logic():
    import io
    import urllib.request
    import zipfile

    try:
        url = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip"
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req) as response:
            buffer = io.BytesIO(response.read())
            with zipfile.ZipFile(buffer) as archive:
                archive.extract("ffmpeg.exe", path=RUNTIME_DIR)
    except Exception:
        pass


class FetchoraWindow(QMainWindow):
    def __init__(self, server):
        super().__init__()
        self._server = server
        self.setWindowTitle(APP_NAME)
        self.resize(1260, 860)
        self.setMinimumSize(1100, 760)

        self.web_view = QWebEngineView(self)
        self.web_view.setUrl(QUrl(f"http://{HOST}:{PORT}/"))
        self.setCentralWidget(self.web_view)

    def closeEvent(self, event):
        try:
            self._server.shutdown()
        finally:
            super().closeEvent(event)


def main():
    if not os.path.exists(SAVE_DIR):
        os.makedirs(SAVE_DIR)

    server_bundle = build_app_server(
        host=HOST,
        port=PORT,
        ui_dir=UI_DIR,
        engine=engine,
        get_settings=get_settings,
        change_save_path=change_save_path,
        set_browser=set_browser,
        open_file=open_file,
        open_folder=open_folder,
        install_ffmpeg=install_ffmpeg_logic,
    )

    engine.progress_callback = server_bundle["on_progress"]
    engine.completion_callback = server_bundle["on_complete"]
    engine.error_callback = server_bundle["on_error"]

    server = server_bundle["start"]()

    app = QApplication(sys.argv)
    window = FetchoraWindow(server)
    window.show()

    try:
        return app.exec()
    finally:
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
