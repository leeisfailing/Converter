"""URL detection handler."""
from Engine.core.ipc import send_response
from Engine.core.config import resource_path
from Engine.core.ytdlp_options import javascript_options
from Engine.core.security import validate_url, validate_string


def handle_detect_url(cmd_args: dict):
    try:
        url = cmd_args["url"]
    except (KeyError, TypeError):
        send_response({"ok": False, "error": "Missing required field: url"})
        return
    if not isinstance(url, str) or not url.strip():
        send_response({"ok": False, "error": "url must be a non-empty string"})
        return
    try:
        url = validate_string(url, "url", 2048)
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
        **javascript_options(),
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        # Many sites only expose separate video/audio streams; "best" requires
        # a combined stream and can reject an otherwise downloadable video.
        'format': 'bestvideo+bestaudio/best/bestaudio',
        'socket_timeout': 30,
        'retries': 3,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }

    if is_youtube:
        cookies_file = resource_path('cookies.txt')
        if cookies_file.exists():
            ydl_opts['cookiefile'] = str(cookies_file)

    import yt_dlp as _yt_dlp
    with _yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)

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
            {"label": "MP4", "value": "mp4", "desc": "Download video", "qualities": [
                {"label": "1080p", "value": "mp4_1080"},
                {"label": "720p", "value": "mp4_720"},
                {"label": "480p", "value": "mp4_480"},
                {"label": "360p", "value": "mp4_360"},
            ]},
            {"label": "MP3", "value": "mp3", "desc": "Extract audio", "qualities": [
                {"label": "320 kbps", "value": "mp3_320"},
                {"label": "256 kbps", "value": "mp3_256"},
                {"label": "192 kbps", "value": "mp3_192"},
                {"label": "128 kbps", "value": "mp3_128"},
                {"label": "64 kbps", "value": "mp3_64"},
            ]},
        ]
    else:
        formats = [
            {"label": "MP3", "value": "mp3", "desc": "Extract audio", "qualities": [
                {"label": "320 kbps", "value": "mp3_320"},
                {"label": "256 kbps", "value": "mp3_256"},
                {"label": "192 kbps", "value": "mp3_192"},
                {"label": "128 kbps", "value": "mp3_128"},
                {"label": "64 kbps", "value": "mp3_64"},
            ]},
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
