"""
Converter Engine - Download + Convert JSON-RPC entry point.
Reads JSON commands from stdin, writes JSON responses to stdout.
"""

import json
import os
import sys
import tempfile
import threading
import traceback
from pathlib import Path

from download_worker import DownloadWorker
from converter_worker import (
    ConverterWorker,
    detect_file_type,
    get_allowed_output_formats,
    VIDEO_OUTPUT_FORMATS,
    PHOTO_OUTPUT_FORMATS,
)


def send_response(obj: dict):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def send_progress(percent: int):
    send_response({"type": "progress", "percent": percent})


def send_finished(ok: bool, message: str = "", file_path: str = ""):
    send_response({"type": "finished", "ok": ok, "message": message, "file_path": file_path})


def _resource_path_local(relative: str) -> Path:
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).parent
    return base / relative


def handle_detect_file(cmd_args: dict):
    file_path = cmd_args["path"]
    file_type = detect_file_type(file_path)
    dev_mode = cmd_args.get("dev_mode", False)
    allowed = get_allowed_output_formats(file_type, dev_mode)
    send_response({
        "ok": True,
        "file_type": file_type,
        "allowed_formats": list(allowed.keys()),
    })


def handle_detect_url(cmd_args: dict):
    url = cmd_args["url"]
    try:
        result = _detect_url_info(url)
        send_response(result)
    except Exception as e:
        send_response({"ok": False, "error": str(e)})


def _detect_url_info(url: str) -> dict:
    import tempfile
    from pathlib import Path

    is_youtube = "youtube.com" in url.lower() or "youtu.be" in url.lower()

    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'noplaylist': True,
        'format': 'best',
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }

    if is_youtube:
        cookies_file = _resource_path_local('cookies.txt')
        if cookies_file.exists():
            ydl_opts['cookiefile'] = str(cookies_file)
        else:
            for browser in ('chrome', 'edge', 'firefox', 'brave'):
                try:
                    ydl_opts['cookiesfrombrowser'] = (browser,)
                    break
                except Exception:
                    continue
            if 'cookiesfrombrowser' not in ydl_opts:
                pass

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


def handle_start_convert(cmd_args: dict):
    input_path = cmd_args["input"]
    output_path = cmd_args["output"]
    output_format = cmd_args["format"]
    dev_mode = cmd_args.get("dev_mode", False)

    def on_progress(percent):
        send_progress(percent)

    def on_finished(ok, message, file_path):
        send_finished(ok, message, file_path)

    worker = ConverterWorker(
        input_path=input_path,
        output_path=output_path,
        output_format=output_format,
        dev_mode=dev_mode,
    )
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.start()
    _current_worker["convert"] = worker


def handle_start_download(cmd_args: dict):
    url = cmd_args["url"]
    output_dir = Path(cmd_args.get("output_dir", tempfile.gettempdir()))
    format_type = cmd_args.get("format_type", "bestvideo+bestaudio/best")

    def on_progress(percent):
        send_progress(percent)

    def on_finished(ok, message, file_path):
        send_finished(ok, message, file_path)

    worker = DownloadWorker(url, output_dir=output_dir, format_type=format_type)
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.start()
    _current_worker["download"] = worker


def handle_cancel():
    for key in list(_current_worker.keys()):
        worker = _current_worker.pop(key, None)
        if worker is not None:
            worker.stop()
    send_response({"ok": True})


_current_worker: dict = {}

HANDLERS = {
    "detect_file": handle_detect_file,
    "detect_url": handle_detect_url,
    "start_convert": handle_start_convert,
    "start_download": handle_start_download,
    "cancel": lambda _: handle_cancel(),
}


def run_interactive_mode():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            cmd = msg.get("cmd", "")
            handler = HANDLERS.get(cmd)
            if handler:
                handler(msg)
            else:
                send_response({"ok": False, "error": f"Unknown command: {cmd}"})
        except Exception:
            send_response({
                "ok": False,
                "error": traceback.format_exc(),
            })

    for key, worker in list(_current_worker.items()):
        if hasattr(worker, '_thread') and worker._thread is not None and worker._thread.is_alive():
            worker._thread.join()
    _current_worker.clear()


def main():
    run_interactive_mode()


if __name__ == "__main__":
    main()
