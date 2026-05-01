# ⚡ FETCHORA

![FETCHORA Industrial Brutalist Downloader](https://img.shields.io/badge/DESIGN-INDUSTRIAL_BRUTALIST-BEF264?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![Eel](https://img.shields.io/badge/UI-EEL_WEB_NATIVE-000000?style=for-the-badge)

**FETCHORA** is a high-performance, industrial-grade download manager designed for power users who demand precision and speed. Built with a focus on selective playlist management and a striking brutalist aesthetic, FETCHORA bridges the gap between CLI power and modern web-native interaction.

---

## 🛠️ CORE FEATURES

- **Selective Playlist Downloader**: Import entire YouTube or Spotify playlists and toggle individual tracks via a technical, high-contrast interface.
- **Intelligent Auto-Renaming**: Never lose a file to an overwrite. FETCHORA automatically detects duplicate filenames and appends a numeric suffix (e.g., `Song (1).mp4`).
- **Synchronized Login**: Sync cookies from Chrome, Edge, Firefox, Brave, or Opera to download private content and bypass rate limits.
- **Multi-Format Extraction**: Choose from 1080p Full HD down to 192kbps MP3 Audio-Only.
- **Industrial Dashboard**: Track speed, progress, and completion status in a "Cyber Lime" environment with zero native OS popups.
- **Native OS Integration**: Instant "Open File" and "Open Folder" actions triggered directly from the completion modal.

---

## 🎨 DESIGN SYSTEM: INDUSTRIAL BRUTALIST

FETCHORA follows a strict technical narrative inspired by geometric precision and high-contrast accessibility.

- **Palette**: Pure Black (`#000000`), Cyber Lime (`#BEF264`), Electric Orange (`#FB923C`).
- **Typography**: Space Grotesk (Geometric Sans).
- **Hard Shadowing**: All UI elements feature solid black shadows to reinforce a physical, "stacked" layout.

---

## 🚀 INSTALLATION & SETUP

### 1. Prerequisites
- **Python 3.10+**
- **FFmpeg**: The app will automatically attempt to install FFmpeg if not detected, but having it in your system PATH is recommended.

### 2. Install Dependencies
```bash
pip install eel yt-dlp
```

### 3. Run the Application
```bash
python main.py
```

---

## 📦 BUILDING THE EXECUTABLE

To bundle FETCHORA into a standalone Windows executable:

1. Install PyInstaller:
   ```bash
   pip install pyinstaller
   ```
2. Run the build command:
   ```bash
   python -m PyInstaller --noconsole --onefile --icon=ui/favicon.ico --add-data "ui;ui" main.py
   ```

---

## 🛡️ CREDITS

- **Engine**: [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- **GUI Framework**: [Eel](https://github.com/python-eel/Eel)
- **Aesthetic**: Developed by Antigravity for IT EMPIRE.

---

*PRODUCED BY IT EMPIRE | 2026*
