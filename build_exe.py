import os

import PyInstaller.__main__


project_dir = os.path.dirname(os.path.abspath(__file__))
ui_dir = os.path.join(project_dir, "ui")
ffmpeg_path = os.path.join(project_dir, "ffmpeg.exe")

args = [
    "main.py",
    "--noconsole",
    "--onefile",
    "--name=FETCHORA",
    f"--add-data={ui_dir};ui/",
    "--collect-all=yt_dlp",
    "--collect-all=PySide6",
    "--collect-all=PySide6.QtWebEngineCore",
    "--collect-all=PySide6.QtWebEngineWidgets",
]

if os.path.exists(ffmpeg_path):
    args.append(f"--add-data={ffmpeg_path};.")

PyInstaller.__main__.run(args)

print("\n\nBuild Complete! Your EXE is in the 'dist' folder.")
