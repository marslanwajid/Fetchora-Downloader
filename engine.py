import yt_dlp
import os
import threading

class YTDLEngine:
    def __init__(self, progress_callback=None, completion_callback=None, error_callback=None):
        self.progress_callback = progress_callback
        self.completion_callback = completion_callback
        self.error_callback = error_callback
        self.cancelled_ids = set()
        self.active_downloads = set()

    def _progress_hook(self, d, download_id):
        if download_id in self.cancelled_ids:
            # Re-raise to stop yt-dlp
            raise Exception("CANCELLED_BY_USER")
            
        if d['status'] == 'downloading':
            try:
                import re
                def strip_ansi(text):
                    return re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])').sub('', text)

                # Calculate percentage
                if '_percent_str' in d:
                    p_str = strip_ansi(d['_percent_str']).replace('%', '').strip()
                    p = float(p_str) / 100
                elif 'downloaded_bytes' in d and 'total_bytes' in d:
                    p = d['downloaded_bytes'] / d['total_bytes']
                else:
                    p = 0
                
                speed = strip_ansi(str(d.get('_speed_str', d.get('speed', '0KB/s'))))
                eta = strip_ansi(str(d.get('_eta_str', d.get('eta', '00:00'))))
                
                if self.progress_callback:
                    self.progress_callback(download_id, p, speed, eta)
            except Exception as e:
                pass
        elif d['status'] == 'finished':
            if self.progress_callback:
                self.progress_callback(download_id, 1.0, "COMPLETED", "00:00")

    def _build_entry_url(self, entry, fallback_url):
        webpage_url = entry.get('webpage_url')
        if webpage_url:
            return webpage_url

        entry_url = entry.get('url')
        if entry_url and entry_url.startswith(('http://', 'https://')):
            return entry_url

        extractor = (entry.get('extractor_key') or entry.get('ie_key') or '').lower()
        entry_id = entry.get('id')
        if entry_id and 'youtube' in extractor:
            return f"https://www.youtube.com/watch?v={entry_id}"

        if entry_url:
            return entry_url

        return fallback_url

    def _sanitize_title(self, title):
        return (
            title.replace('/', '_')
            .replace('\\', '_')
            .replace(':', '_')
            .replace('*', '_')
            .replace('?', '_')
            .replace('"', '_')
            .replace('<', '_')
            .replace('>', '_')
            .replace('|', '_')
        )

    def _get_file_size(self, file_path):
        try:
            return os.path.getsize(file_path) if file_path and os.path.exists(file_path) else 0
        except OSError:
            return 0

    def get_info(self, url, browser=None):
        try:
            ydl_opts = {
                'quiet': True, 
                'no_warnings': True,
                'extract_flat': 'in_playlist',
            }
            if browser and browser != "None":
                ydl_opts['cookiesfrombrowser'] = (browser.lower(),)

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                
                if 'entries' in info:
                    entries = []
                    for entry in info['entries']:
                        if not entry: continue
                        entries.append({
                            'id': entry.get('id'),
                            'title': entry.get('title', 'Unknown Title'),
                            'url': self._build_entry_url(entry, url),
                            'duration': entry.get('duration'),
                            'thumbnail': entry.get('thumbnail')
                        })
                    return {
                        'type': 'playlist',
                        'title': info.get('title', 'Playlist'),
                        'entries': entries
                    }
                
                formats = info.get('formats', [])
                if not formats:
                    formats = [{
                        'format_id': 'best',
                        'ext': info.get('ext', 'mp4'),
                        'resolution': f"{info.get('width', '???')}x{info.get('height', '???')}",
                        'vcodec': 'yes',
                        'acodec': 'yes',
                        'filesize': info.get('filesize')
                    }]
                
                detailed_formats = []
                for f in formats:
                    ext = f.get('ext', 'N/A')
                    resolution = f.get('resolution') or f"{f.get('width', '???')}x{f.get('height', '???')}"
                    vcodec = f.get('vcodec', 'none')
                    acodec = f.get('acodec', 'none')
                    filesize = f.get('filesize')
                    filesize_str = f"{filesize / (1024*1024):.1f} MB" if filesize else "Unknown"
                    
                    if vcodec != 'none' and acodec != 'none': f_type = "Video + Audio"
                    elif vcodec != 'none': f_type = "Video (Mute)"
                    else: f_type = "Audio Only"

                    detailed_formats.append({
                        'id': f.get('format_id'),
                        'ext': ext,
                        'resolution': resolution,
                        'type': f_type,
                        'size': filesize_str,
                        'note': f.get('format_note', '')
                    })
                
                return {
                    'type': 'video',
                    'title': info.get('title', 'Unknown Title'),
                    'thumbnail': info.get('thumbnail'),
                    'duration': info.get('duration'),
                    'formats': detailed_formats,
                    'webpage_url': info.get('webpage_url')
                }
        except Exception as e:
            if self.error_callback:
                self.error_callback(None, str(e))
            return None

    def _get_unique_path(self, save_path, title, ext):
        base_path = os.path.join(save_path, title)
        counter = 0
        final_path = f"{base_path}.{ext}"
        while os.path.exists(final_path):
            counter += 1
            final_path = f"{base_path} ({counter}).{ext}"
        return final_path

    def download(self, url, format_id='best', save_path='./downloads', browser=None, download_id=None):
        if not os.path.exists(save_path):
            os.makedirs(save_path)

        if download_id in self.cancelled_ids:
            self.cancelled_ids.remove(download_id)

        requested_format = str(format_id or 'best')
        wants_audio_only = requested_format in {'audio', 'bestaudio', 'bestaudio/best'}

        if 'youtube.com' in url or 'youtu.be' in url:
            final_format = (
                f"{requested_format}+bestaudio/best"
                if requested_format != 'best' and not wants_audio_only
                else requested_format
            )
        else:
            final_format = requested_format

        local_ffmpeg = os.path.join(os.getcwd(), 'ffmpeg.exe')
        ffmpeg_path = local_ffmpeg if os.path.exists(local_ffmpeg) else None

        try:
            info_opts = {
                'quiet': True,
                'no_warnings': True,
            }
            if browser and browser != "None":
                info_opts['cookiesfrombrowser'] = (browser.lower(),)

            with yt_dlp.YoutubeDL(info_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                title = self._sanitize_title(info.get('title', 'Video'))
                ext = 'mp4' if not wants_audio_only else 'mp3'
                unique_path = self._get_unique_path(save_path, title, ext)
        except:
            unique_path = os.path.join(save_path, '%(title)s.%(ext)s')

        ydl_opts = {
            'format': final_format,
            'outtmpl': unique_path,
            'progress_hooks': [lambda d: self._progress_hook(d, download_id)],
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'merge_output_format': 'mp4' if not wants_audio_only else None,
        }

        if wants_audio_only:
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]

        if browser and browser != "None":
            ydl_opts['cookiesfrombrowser'] = (browser.lower(),)
        if ffmpeg_path:
            ydl_opts['ffmpeg_location'] = ffmpeg_path

        def run():
            self.active_downloads.add(download_id)
            try:
                actual_path = ""
                def final_hook(d):
                    nonlocal actual_path
                    if d['status'] == 'finished':
                        actual_path = d.get('info_dict', {}).get('_filename') or d.get('filename')

                def postprocessor_hook(d):
                    nonlocal actual_path
                    if d.get('status') == 'finished':
                        info = d.get('info_dict') or {}
                        actual_path = (
                            info.get('filepath')
                            or info.get('_filename')
                            or actual_path
                        )

                ydl_opts['progress_hooks'].append(final_hook)
                ydl_opts['postprocessor_hooks'] = [postprocessor_hook]
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([url])
                if self.completion_callback:
                    abs_path = os.path.abspath(actual_path).replace('\\', '/') if actual_path else ""
                    file_size = self._get_file_size(abs_path)
                    self.completion_callback(download_id, abs_path, file_size)
            except Exception as e:
                if str(e) == "CANCELLED_BY_USER":
                    return
                if self.error_callback:
                    self.error_callback(download_id, str(e))
            finally:
                self.active_downloads.discard(download_id)
                self.cancelled_ids.discard(download_id)

        thread = threading.Thread(target=run, daemon=True)
        thread.start()
        return thread

    def cancel(self, download_id=None):
        if download_id:
            self.cancelled_ids.add(download_id)
        else:
            for active_id in list(self.active_downloads):
                if active_id:
                    self.cancelled_ids.add(active_id)
