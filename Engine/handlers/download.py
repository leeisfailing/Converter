"""Download command handler."""
import tempfile
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished, send_download_status
from Engine.core.security import validate_url, validate_output_dir, validate_string
from Engine.workers.downloader import DownloadWorker


def handle_start_download(cmd_args: dict):
    try:
        url = cmd_args["url"]
    except KeyError:
        send_finished(False, "Missing required field: url", "")
        return None
    try:
        validate_url(url)
        output_dir_str = cmd_args.get("output_dir", tempfile.gettempdir())
        output_dir_str = validate_output_dir(output_dir_str)
        output_dir = Path(output_dir_str)
        format_type = cmd_args.get("format_type", "bestvideo+bestaudio/best")
        validate_string(format_type, "format_type", 128)
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

    worker = DownloadWorker(url, output_dir=output_dir, format_type=format_type)
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.on_download_status = on_download_status
    worker.start()
    return worker
