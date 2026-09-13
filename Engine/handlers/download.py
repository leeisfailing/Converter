"""Download command handler."""
import tempfile
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished, send_download_status
from Engine.core.security import validate_url, validate_output_dir, validate_string, validate_download_format
from Engine.workers.downloader import DownloadWorker


def handle_start_download(cmd_args: dict):
    try:
        url = cmd_args["url"]
    except KeyError:
        send_finished(False, "Missing required field: url", "")
        return None
    if not isinstance(url, str) or not url.strip():
        send_finished(False, "url must be a non-empty string", "")
        return None
    try:
        url = validate_string(url, "url", 2048)
        validate_url(url)
        output_dir_str = cmd_args.get("output_dir", tempfile.gettempdir())
        if not isinstance(output_dir_str, str) or not output_dir_str.strip():
            send_finished(False, "output_dir must be a non-empty string", "")
            return None
        output_dir_str = validate_output_dir(output_dir_str)
        output_dir = Path(output_dir_str)
        format_type = cmd_args.get("format_type", "bestvideo+bestaudio/best")
        if not isinstance(format_type, str) or not format_type.strip():
            send_finished(False, "format_type must be a non-empty string", "")
            return None
        format_type = validate_string(format_type, "format_type", 128)
        format_type = validate_download_format(format_type)
        write_subtitles = bool(cmd_args.get("write_subtitles", False))
        write_thumbnail = bool(cmd_args.get("write_thumbnail", False))
        use_browser_cookies = bool(cmd_args.get("use_browser_cookies", False))
    except ValueError as e:
        send_finished(False, str(e), "")
        return None

    def on_progress(percent):
        send_progress(percent)

    def on_finished(ok, message, file_path):
        send_finished(ok, message, file_path)

    def on_download_status(info):
        send_download_status(
            percent=info.get('percent'),
            speed=info.get('speed'),
            eta=info.get('eta'),
            is_live=info.get('is_live', False),
            status=info.get('status', ''),
        )

    worker = DownloadWorker(
        url, output_dir=output_dir, format_type=format_type,
        write_subtitles=write_subtitles, write_thumbnail=write_thumbnail,
        use_browser_cookies=use_browser_cookies,
    )
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.on_download_status = on_download_status
    worker.start()
    return worker
