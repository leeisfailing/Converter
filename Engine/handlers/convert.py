"""Convert command handler."""
import os
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished
from Engine.core.security import validate_file_exists, validate_output_path, validate_string, validate_output_dir
from Engine.workers.converter import ConverterWorker

ALLOWED_FORMATS = {"mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "mp3", "aac", "wav", "flac", "ogg"}


def handle_start_convert(cmd_args: dict):
    try:
        input_path = cmd_args["input"]
        output_path = cmd_args["output"]
        output_format = cmd_args["format"]
    except KeyError as e:
        send_finished(False, f"Missing required field: {e}", "")
        return None
    if not isinstance(input_path, str) or not input_path.strip():
        send_finished(False, "input must be a non-empty string", "")
        return None
    if not isinstance(output_path, str) or not output_path.strip():
        send_finished(False, "output must be a non-empty string", "")
        return None
    if not isinstance(output_format, str) or not output_format.strip():
        send_finished(False, "format must be a non-empty string", "")
        return None
    try:
        input_path = validate_file_exists(input_path, "input")
        output_path = validate_output_path(output_path, "output")
        validate_string(output_format, "format", 64)
    except ValueError as e:
        send_finished(False, str(e), "")
        return None
    output_format = output_format.lower().strip()
    if output_format not in ALLOWED_FORMATS:
        send_finished(False, f"Invalid format: {output_format}. Allowed: {', '.join(sorted(ALLOWED_FORMATS))}", "")
        return None
    output_parent = str(Path(output_path).parent)
    try:
        validate_output_dir(output_parent)
    except ValueError:
        try:
            os.makedirs(output_parent, exist_ok=True)
        except OSError as e:
            send_finished(False, f"Cannot create output directory: {e}", "")
            return None
    dev_mode = cmd_args.get("dev_mode", False)
    if not isinstance(dev_mode, bool):
        send_finished(False, "dev_mode must be a boolean", "")
        return None

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
    return worker
