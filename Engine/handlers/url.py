"""URL detection handler."""
from Engine.core.ipc import send_response
from Engine.core.config import resource_path
from Engine.core.security import validate_url


def handle_detect_url(cmd_args: dict):
    try:
        url = cmd_args["url"]
    except (KeyError, TypeError):
        send_response({"ok": False, "error": "Missing required field: url"})
        return
    try:
        validate_url(url)
    except ValueError as e:
        send_response({"ok": False, "error": str(e)})
        return
    try:
        result = _detect_url_info(url)
        send_response(result)
    except Exception as e:
        send_response({"ok": False, "error": str(e)})


def _detect_url_info(url: str) -> dict:
    is_youtube = "youtube.com" in url.lower() or "youtu.be" in url.lower()

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'format': 'best',
        'socket_timeout': 30,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }

    if is_youtube:
        cookies_file = resource_path('cookies.txt')
        if cookies_file.exists():
            ydl_opts['cookiefile'] = str(cookies_file)
        else:
            ydl_opts['cookiesfrombrowser'] = ('chrome',)

    import yt_dlp as _yt_dlp
    try:
        with _yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        if 'cookiesfrombrowser' in ydl_opts:
            del ydl_opts['cookiesfrombrowser']
            with _yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
        else:
            raise

    if info is None:
        return {"ok": False, "error": "Could not extract info from URL"}

    title = info.get('title', 'Unknown')
    duration = info.get('duration')
    thumbnail = info.get('thumbnail', '')
    webpage_url = info.get('webpage_url', url)
    ext = info.get('ext', '')
    is_live = info.get('is_live', False)

    if ext in ('mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'ogg', 'opus', 'mp3', 'aac', 'wav', 'flac'):
        is_video = ext in ('mp4', 'mkv', 'webm', 'avi', 'mov', 'flv')
        is_audio = ext in ('mp3', 'aac', 'wav', 'flac', 'ogg', 'opus')
    else:
        is_video = True
        is_audio = False

    if is_video:
        formats = [
            {"label": "Best 4K", "value": "best_4k", "desc": "Up to 2160p"},
            {"label": "Best 1080p", "value": "best_1080", "desc": "Up to 1080p"},
            {"label": "MP4 4K", "value": "mp4_4k", "desc": "Up to 2160p, MP4"},
            {"label": "MP4 1080p", "value": "mp4_1080", "desc": "Up to 1080p, MP4"},
            {"label": "MP4 720p", "value": "mp4", "desc": "Up to 720p, MP4"},
            {"label": "MP3", "value": "mp3", "desc": "Extract audio as MP3"},
        ]
    else:
        formats = [
            {"label": "Original", "value": "original", "desc": f"Keep {ext} format"},
            {"label": "MP3", "value": "mp3", "desc": "Convert to MP3"},
        ]

    duration_str = ""
    if duration:
        mins, secs = divmod(int(duration), 60)
        hours, mins = divmod(mins, 60)
        if hours > 0:
            duration_str = f"{hours}:{mins:02d}:{secs:02d}"
        else:
            duration_str = f"{mins}:{secs:02d}"

    return {
        "ok": True,
        "title": title,
        "duration": duration_str,
        "thumbnail": thumbnail,
        "webpage_url": webpage_url,
        "is_live": is_live,
        "formats": formats,
        "format_type": "video" if is_video else "audio",
    }
