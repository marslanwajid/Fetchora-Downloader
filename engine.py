import mimetypes
import os
import re
import sys
import threading
import urllib.parse
import urllib.request

import yt_dlp


DOCUMENT_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".csv",
    ".txt",
    ".rtf",
    ".odt",
}

ARCHIVE_EXTENSIONS = {".zip", ".rar", ".7z", ".tar", ".gz"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg"}
AUDIO_EXTENSIONS = {".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v"}


class YTDLEngine:
    def __init__(self, progress_callback=None, completion_callback=None, error_callback=None):
        self.progress_callback = progress_callback
        self.completion_callback = completion_callback
        self.error_callback = error_callback
        self.cancelled_ids = set()
        self.active_downloads = set()

    def _strip_ansi(self, text):
        return re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])").sub("", text)

    def _progress_hook(self, data, download_id):
        if download_id in self.cancelled_ids:
            raise Exception("CANCELLED_BY_USER")

        status = data.get("status")
        if status == "downloading":
            try:
                if "_percent_str" in data:
                    percent = self._strip_ansi(data["_percent_str"]).replace("%", "").strip()
                    progress = float(percent) / 100
                elif data.get("downloaded_bytes") and data.get("total_bytes"):
                    progress = data["downloaded_bytes"] / data["total_bytes"]
                else:
                    progress = 0

                speed = self._strip_ansi(str(data.get("_speed_str", data.get("speed", "0KB/s"))))
                eta = self._strip_ansi(str(data.get("_eta_str", data.get("eta", "00:00"))))

                if self.progress_callback:
                    self.progress_callback(download_id, progress, speed, eta)
            except Exception:
                pass
        elif status == "finished" and self.progress_callback:
            self.progress_callback(download_id, 1.0, "COMPLETED", "00:00")

    def _sanitize_title(self, title):
        return (
            title.replace("/", "_")
            .replace("\\", "_")
            .replace(":", "_")
            .replace("*", "_")
            .replace("?", "_")
            .replace('"', "_")
            .replace("<", "_")
            .replace(">", "_")
            .replace("|", "_")
        )

    def _get_file_size(self, file_path):
        try:
            return os.path.getsize(file_path) if file_path and os.path.exists(file_path) else 0
        except OSError:
            return 0

    def _get_unique_path(self, save_path, title, ext):
        base_path = os.path.join(save_path, title)
        counter = 0
        final_path = f"{base_path}.{ext}"
        while os.path.exists(final_path):
            counter += 1
            final_path = f"{base_path} ({counter}).{ext}"
        return final_path

    def _kind_from_extension(self, extension):
        ext = extension.lower()
        if ext in DOCUMENT_EXTENSIONS:
            return "document"
        if ext in ARCHIVE_EXTENSIONS:
            return "archive"
        if ext in IMAGE_EXTENSIONS:
            return "image"
        if ext in AUDIO_EXTENSIONS:
            return "audio_file"
        if ext in VIDEO_EXTENSIONS:
            return "video_file"
        return "file"

    def _kind_from_content_type(self, content_type):
        content_type = (content_type or "").split(";")[0].strip().lower()
        if content_type.startswith("video/"):
            return "video_file"
        if content_type.startswith("audio/"):
            return "audio_file"
        if content_type.startswith("image/"):
            return "image"
        if any(token in content_type for token in ("pdf", "word", "excel", "powerpoint", "text/")):
            return "document"
        if any(token in content_type for token in ("zip", "octet-stream", "compressed")):
            return "file"
        return "file"

    def _build_entry_url(self, entry, fallback_url):
        webpage_url = entry.get("webpage_url")
        if webpage_url:
            return webpage_url

        entry_url = entry.get("url")
        if entry_url and entry_url.startswith(("http://", "https://")):
            return entry_url

        extractor = (entry.get("extractor_key") or entry.get("ie_key") or "").lower()
        entry_id = entry.get("id")
        if entry_id and "youtube" in extractor:
            return f"https://www.youtube.com/watch?v={entry_id}"

        return entry_url or fallback_url

    def _normalize_media_page_url(self, url):
        try:
            parsed = urllib.parse.urlparse(url)
            host = (parsed.netloc or "").lower()
            query = urllib.parse.parse_qs(parsed.query)

            if "youtube.com" in host and parsed.path == "/watch" and query.get("v"):
                video_id = query["v"][0]
                return f"https://www.youtube.com/watch?v={video_id}"

            return url
        except Exception:
            return url

    def _probe_direct_resource(self, url):
        parsed = urllib.parse.urlparse(url)
        path = urllib.parse.unquote(parsed.path or "")
        extension = os.path.splitext(path)[1].lower()
        guessed_type, _ = mimetypes.guess_type(path)

        result = {
            "is_direct": False,
            "url": url,
            "filename": os.path.basename(path) or "download",
            "extension": extension,
            "content_type": guessed_type or "",
            "size": None,
            "kind": self._kind_from_extension(extension) if extension else "file",
        }

        direct_by_extension = extension in (
            DOCUMENT_EXTENSIONS | ARCHIVE_EXTENSIONS | IMAGE_EXTENSIONS | AUDIO_EXTENSIONS | VIDEO_EXTENSIONS
        )

        request = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0"},
            method="HEAD",
        )

        try:
            with urllib.request.urlopen(request, timeout=8) as response:
                content_type = response.headers.get("Content-Type", "")
                content_length = response.headers.get("Content-Length")
                disposition = response.headers.get("Content-Disposition", "")

                if content_length and content_length.isdigit():
                    result["size"] = int(content_length)

                if content_type:
                    result["content_type"] = content_type
                    result["kind"] = self._kind_from_content_type(content_type)

                if "filename=" in disposition.lower():
                    raw_name = disposition.split("filename=")[-1].strip().strip('"')
                    result["filename"] = raw_name or result["filename"]
                    if not result["extension"]:
                        result["extension"] = os.path.splitext(result["filename"])[1].lower()

                if not result["extension"] and result["filename"]:
                    result["extension"] = os.path.splitext(result["filename"])[1].lower()

                if direct_by_extension or (content_type and not content_type.startswith("text/html")) or "filename=" in disposition.lower():
                    result["is_direct"] = True
        except Exception:
            result["is_direct"] = direct_by_extension

        return result

    def _make_direct_info(self, probe):
        filename = probe["filename"] or "download"
        title = self._sanitize_title(os.path.splitext(filename)[0] or filename)
        size = probe["size"]
        size_label = f"{size / (1024 * 1024):.1f} MB" if size else "Unknown"
        kind_label_map = {
            "document": "Document",
            "archive": "Archive",
            "image": "Image",
            "audio_file": "Audio File",
            "video_file": "Video File",
            "file": "File",
        }
        kind = probe["kind"]
        type_label = kind_label_map.get(kind, "File")

        return {
            "type": "file",
            "source_kind": kind,
            "title": title,
            "thumbnail": None,
            "duration": None,
            "formats": [
                {
                    "id": "direct",
                    "ext": (probe["extension"] or "").lstrip(".") or "bin",
                    "resolution": "DIRECT",
                    "type": f"{type_label} Download",
                    "size": size_label,
                    "note": probe["content_type"] or "Direct resource",
                }
            ],
            "webpage_url": probe["url"],
            "filename": filename,
        }

    def get_info(self, url, browser=None):
        if str(url or "").startswith(("blob:", "mediastream:")):
            if self.error_callback:
                self.error_callback(None, "Blob media was detected in the browser. Fetchora needs the page URL instead of the blob URL.")
            return None

        url = self._normalize_media_page_url(url)
        probe = self._probe_direct_resource(url)
        if probe["is_direct"]:
            return self._make_direct_info(probe)

        try:
            parsed = urllib.parse.urlparse(url)
            host = (parsed.netloc or "").lower()
            query = urllib.parse.parse_qs(parsed.query)
            is_youtube_watch = "youtube.com" in host and parsed.path == "/watch" and bool(query.get("v"))

            ydl_opts = {
                "quiet": True,
                "no_warnings": True,
                "extract_flat": "in_playlist",
            }
            if is_youtube_watch:
                ydl_opts["noplaylist"] = True
            if browser and browser != "None":
                ydl_opts["cookiesfrombrowser"] = (browser.lower(),)

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)

            if "entries" in info:
                entries = []
                for entry in info["entries"]:
                    if not entry:
                        continue
                    entries.append(
                        {
                            "id": entry.get("id"),
                            "title": entry.get("title", "Unknown Title"),
                            "url": self._build_entry_url(entry, url),
                            "duration": entry.get("duration"),
                            "thumbnail": entry.get("thumbnail"),
                        }
                    )

                return {
                    "type": "playlist",
                    "source_kind": "playlist",
                    "title": info.get("title", "Playlist"),
                    "entries": entries,
                }

            formats = info.get("formats", [])
            detailed_formats = []
            for item in formats:
                ext = item.get("ext", "N/A")
                resolution = item.get("resolution") or f"{item.get('width', '???')}x{item.get('height', '???')}"
                vcodec = item.get("vcodec", "none")
                acodec = item.get("acodec", "none")
                filesize = item.get("filesize") or item.get("filesize_approx")
                filesize_str = f"{filesize / (1024 * 1024):.1f} MB" if filesize else "Unknown"

                if vcodec != "none" and acodec != "none":
                    item_type = "Video + Audio"
                elif vcodec != "none":
                    item_type = "Video (Mute)"
                else:
                    item_type = "Audio Only"

                detailed_formats.append(
                    {
                        "id": item.get("format_id"),
                        "ext": ext,
                        "resolution": resolution,
                        "type": item_type,
                        "size": filesize_str,
                        "note": item.get("format_note", ""),
                    }
                )

            if not detailed_formats:
                detailed_formats.append(
                    {
                        "id": "best",
                        "ext": info.get("ext", "mp4"),
                        "resolution": "AUTO",
                        "type": "Video + Audio",
                        "size": "Unknown",
                        "note": "Best available",
                    }
                )

            return {
                "type": "video",
                "source_kind": "audio" if info.get("vcodec") == "none" else "video",
                "title": info.get("title", "Unknown Title"),
                "thumbnail": info.get("thumbnail"),
                "duration": info.get("duration"),
                "formats": detailed_formats,
                "webpage_url": info.get("webpage_url") or url,
            }
        except Exception as exc:
            if self.error_callback:
                self.error_callback(None, str(exc))
            return None

    def _download_direct_resource(self, url, save_path, download_id):
        probe = self._probe_direct_resource(url)
        filename = probe["filename"] or "download"
        extension = probe["extension"].lstrip(".") if probe["extension"] else "bin"
        title = self._sanitize_title(os.path.splitext(filename)[0] or filename)
        target_path = self._get_unique_path(save_path, title, extension)

        def run():
            self.active_downloads.add(download_id)
            try:
                request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=30) as response, open(target_path, "wb") as file_obj:
                    total = response.headers.get("Content-Length")
                    total_bytes = int(total) if total and total.isdigit() else 0
                    downloaded = 0

                    while True:
                        if download_id in self.cancelled_ids:
                            raise Exception("CANCELLED_BY_USER")

                        chunk = response.read(1024 * 128)
                        if not chunk:
                            break

                        file_obj.write(chunk)
                        downloaded += len(chunk)

                        progress = (downloaded / total_bytes) if total_bytes else 0
                        speed_label = f"{downloaded / 1024:.0f} KB"
                        if self.progress_callback:
                            self.progress_callback(download_id, progress, speed_label, "--:--")

                if self.completion_callback:
                    abs_path = os.path.abspath(target_path).replace("\\", "/")
                    self.completion_callback(download_id, abs_path, self._get_file_size(abs_path))
            except Exception as exc:
                if str(exc) != "CANCELLED_BY_USER" and self.error_callback:
                    self.error_callback(download_id, str(exc))
            finally:
                self.active_downloads.discard(download_id)
                self.cancelled_ids.discard(download_id)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    def download(self, url, format_id="best", save_path="./downloads", browser=None, download_id=None):
        if not os.path.exists(save_path):
            os.makedirs(save_path)

        if download_id in self.cancelled_ids:
            self.cancelled_ids.remove(download_id)

        requested_format = str(format_id or "best")
        if requested_format == "direct":
            return self._download_direct_resource(url, save_path, download_id)

        direct_probe = self._probe_direct_resource(url)
        if direct_probe["is_direct"]:
            return self._download_direct_resource(url, save_path, download_id)

        wants_audio_only = requested_format in {"audio", "bestaudio", "bestaudio/best"}
        if wants_audio_only:
            requested_format = "bestaudio/best"

        if "youtube.com" in url or "youtu.be" in url:
            final_format = (
                f"{requested_format}+bestaudio/best"
                if requested_format != "best" and not wants_audio_only
                else requested_format
            )
        else:
            final_format = requested_format

        bundled_ffmpeg = os.path.join(BASE_DIR, "ffmpeg.exe")
        local_ffmpeg = os.path.join(RUNTIME_DIR, "ffmpeg.exe")
        ffmpeg_path = bundled_ffmpeg if os.path.exists(bundled_ffmpeg) else (local_ffmpeg if os.path.exists(local_ffmpeg) else None)

        try:
            info_opts = {
                "quiet": True,
                "no_warnings": True,
            }
            if browser and browser != "None":
                info_opts["cookiesfrombrowser"] = (browser.lower(),)

            with yt_dlp.YoutubeDL(info_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                title = self._sanitize_title(info.get("title", "Video"))
                ext = "mp4" if not wants_audio_only else "mp3"
                unique_path = self._get_unique_path(save_path, title, ext)
        except Exception:
            unique_path = os.path.join(save_path, "%(title)s.%(ext)s")

        ydl_opts = {
            "format": final_format,
            "outtmpl": unique_path,
            "progress_hooks": [lambda data: self._progress_hook(data, download_id)],
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "merge_output_format": "mp4" if not wants_audio_only else None,
        }

        if wants_audio_only:
            ydl_opts["postprocessors"] = [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ]

        if browser and browser != "None":
            ydl_opts["cookiesfrombrowser"] = (browser.lower(),)
        if ffmpeg_path:
            ydl_opts["ffmpeg_location"] = ffmpeg_path

        def run():
            self.active_downloads.add(download_id)
            try:
                actual_path = ""

                def final_hook(data):
                    nonlocal actual_path
                    if data.get("status") == "finished":
                        actual_path = data.get("info_dict", {}).get("_filename") or data.get("filename", "")

                def postprocessor_hook(data):
                    nonlocal actual_path
                    if data.get("status") == "finished":
                        info = data.get("info_dict") or {}
                        actual_path = info.get("filepath") or info.get("_filename") or actual_path

                ydl_opts["progress_hooks"].append(final_hook)
                ydl_opts["postprocessor_hooks"] = [postprocessor_hook]

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])

                if self.completion_callback:
                    abs_path = os.path.abspath(actual_path).replace("\\", "/") if actual_path else ""
                    self.completion_callback(download_id, abs_path, self._get_file_size(abs_path))
            except Exception as exc:
                if str(exc) != "CANCELLED_BY_USER" and self.error_callback:
                    self.error_callback(download_id, str(exc))
            finally:
                self.active_downloads.discard(download_id)
                self.cancelled_ids.discard(download_id)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    def cancel(self, download_id=None):
        if download_id:
            self.cancelled_ids.add(download_id)
            return

        for active_id in list(self.active_downloads):
            if active_id:
                self.cancelled_ids.add(active_id)
BASE_DIR = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
RUNTIME_DIR = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))
