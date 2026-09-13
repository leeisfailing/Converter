"""Reduce command handler."""
import os
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished
from Engine.core.security import validate_file_exists, validate_output_path, validate_string, validate_output_dir
from Engine.workers.reducer import ReducerWorker

ALLOWED_TYPES = {"video", "photo", "audio"}


def handle_start_reduce(cmd_args: dict):
    try:
        input_path = cmd_args["input"]
        output_path = cmd_args["output"]
        file_type = cmd_args["file_type"]
    except KeyError as e:
        send_finished(False, f"Missing required field: {e}", "")
        return None
    if not isinstance(input_path, str) or not input_path.strip():
        send_finished(False, "input must be a non-empty string", "")
        return None
    if not isinstance(output_path, str) or not output_path.strip():
        send_finished(False, "output must be a non-empty string", "")
        return None
    if not isinstance(file_type, str) or not file_type.strip():
        send_finished(False, "file_type must be a non-empty string", "")
        return None
    file_type = file_type.lower().strip()
    if file_type not in ALLOWED_TYPES:
        send_finished(False, f"Invalid file_type: {file_type}. Allowed: {', '.join(sorted(ALLOWED_TYPES))}", "")
        return None
    try:
        input_path = validate_file_exists(input_path, "input")
        output_path = validate_output_path(output_path, "output")
        validate_string(file_type, "file_type", 32)
    except ValueError as e:
        send_finished(False, str(e), "")
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
    quality = cmd_args.get("quality", 50)
    if not isinstance(quality, int) or quality < 1 or quality > 100:
        send_finished(False, "quality must be an integer between 1 and 100", "")
        return None
    max_width = cmd_args.get("max_width", None)
    target_bytes = cmd_args.get("target_bytes")
    if target_bytes is not None and (type(target_bytes) is not int or not 0 < target_bytes <= 10_000_000_000):
        send_finished(False, "Target size must be greater than zero and at most 10 GB", "")
        return None
    if max_width is not None:
        if not isinstance(max_width, int) or max_width < 1:
            send_finished(False, "max_width must be a positive integer or null", "")
            return None

    def on_progress(percent):
        send_progress(percent)

    def on_finished(ok, message, file_path):
        send_finished(ok, message, file_path)

    worker = ReducerWorker(
        input_path=input_path,
        output_path=output_path,
        quality=quality,
        max_width=max_width,
        file_type=file_type,
        target_bytes=target_bytes,
    )
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.start()
    return worker
