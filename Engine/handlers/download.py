"""Download command handler."""
import tempfile
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished
from Engine.workers.downloader import DownloadWorker


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
    return worker
