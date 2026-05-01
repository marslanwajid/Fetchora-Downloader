import eel
import os
import threading
import tkinter as tk
from tkinter import filedialog
import shutil
from engine import YTDLEngine

# Configuration
APP_NAME = "FETCHORA"
SAVE_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "FETCHORA_Downloads")
BROWSER = "None"

# Initialize Engine
engine = YTDLEngine()

# --- Eel Exposed Functions ---

@eel.expose
def get_video_info(url):
    global BROWSER
    return engine.get_info(url, browser=BROWSER)

@eel.expose
def start_download(url, format_id, download_id):
    global BROWSER
    engine.download(url, format_id=format_id, save_path=SAVE_DIR, browser=BROWSER, download_id=download_id)

@eel.expose
def open_file(path):
    if os.path.exists(path):
        os.startfile(path)

@eel.expose
def open_folder(path):
    folder = os.path.dirname(path) if os.path.isfile(path) else path
    if os.path.exists(folder):
        os.startfile(folder)

@eel.expose
def start_bulk_download(items, quality):
    global BROWSER
    # Map quality labels to format IDs
    format_map = {
        "1080p": "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "720p": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "480p": "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
        "360p": "bestvideo[height<=360]+bestaudio/best[height<=360]/best",
        "best": "best",
        "audio": "bestaudio/best"
    }
    format_id = format_map.get(quality, "best")
    
    for item in items:
        engine.download(item['url'], format_id=format_id, save_path=SAVE_DIR, browser=BROWSER, download_id=item['id'])

@eel.expose
def cancel_download(download_id):
    engine.cancel(download_id)

@eel.expose
def cancel_all_downloads():
    engine.cancel()

@eel.expose
def set_browser(browser_name):
    global BROWSER
    BROWSER = browser_name

@eel.expose
def get_clipboard():
    root = tk.Tk()
    root.withdraw()
    try:
        text = root.clipboard_get()
    except:
        text = ""
    root.destroy()
    return text

def on_progress(dl_id, p, speed, eta):
    eel.onProgress(dl_id, p, speed, eta)

def on_complete(dl_id, file_path, file_size):
    eel.onComplete(dl_id, file_path, file_size)

def on_error(dl_id, error):
    eel.onError(dl_id, error)

def system_message(message, level="info"):
    eel.onSystemMessage(message, level)

# Set callbacks
engine.progress_callback = on_progress
engine.completion_callback = on_complete
engine.error_callback = on_error

# --- FFmpeg Installer ---

def install_ffmpeg_logic():
    import urllib.request
    import zipfile
    import io
    
    try:
        system_message("Installing FFmpeg package...", "info")
        url = "https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v4.4.1/ffmpeg-4.4.1-win-64.zip"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            buffer = io.BytesIO(response.read())
            with zipfile.ZipFile(buffer) as z:
                z.extract('ffmpeg.exe', path=os.getcwd())
        system_message("FFmpeg installed successfully.", "success")
    except Exception as e:
        system_message(f"Failed to install FFmpeg: {e}", "error")

@eel.expose
def trigger_ffmpeg_install():
    threading.Thread(target=install_ffmpeg_logic).start()

@eel.expose
def get_settings():
    local_ffmpeg = os.path.join(os.getcwd(), 'ffmpeg.exe')
    has_ffmpeg = shutil.which("ffmpeg") or os.path.exists(local_ffmpeg)
    return {
        "save_path": SAVE_DIR,
        "has_ffmpeg": bool(has_ffmpeg),
        "browser": BROWSER
    }

@eel.expose
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

# --- Main Start ---

if __name__ == "__main__":
    if not os.path.exists(SAVE_DIR):
        os.makedirs(SAVE_DIR)
        
    # Initialize Eel
    eel.init('ui')
    
    # Start App
    try:
        eel.start('index.html', size=(1024, 768))
    except (SystemExit, KeyboardInterrupt):
        print("App closed")
