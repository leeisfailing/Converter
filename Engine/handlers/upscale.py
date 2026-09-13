"""Upscale command handler."""
import os
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished
from Engine.core.security import validate_file_exists, validate_output_path, validate_string, validate_output_dir
from Engine.workers.upscaler import UpscalerWorker, UPSCALE_PRESETS

ALLOWED_TYPES = {"video", "photo"}


def handle_start_upscale(cmd_args: dict):
    try:
        input_path = cmd_args["input"]
        output_path = cmd_args["output"]
        target = cmd_args["target"]
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
    if not isinstance(target, str) or target not in UPSCALE_PRESETS:
        send_finished(False, f"Invalid target: {target}. Must be one of: {', '.join(sorted(UPSCALE_PRESETS))}", "")
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
    use_gpu = cmd_args.get("use_gpu", False)
    if not isinstance(use_gpu, bool):
        send_finished(False, "use_gpu must be a boolean", "")
        return None

    preferred_encoder = cmd_args.get("preferred_encoder", "")
    from Engine.core.gpu import _ALL_HARDWARE_ENCODERS
    if not isinstance(preferred_encoder, str) or preferred_encoder not in {"", "libx264", *(e[0] for e in _ALL_HARDWARE_ENCODERS)}:
        send_finished(False, "Invalid preferred encoder", "")
        return None

    def on_progress(percent):
        send_progress(percent)

    def on_finished(ok, message, file_path):
        send_finished(ok, message, file_path)

    worker = UpscalerWorker(
        input_path=input_path,
        output_path=output_path,
        target=target,
        file_type=file_type,
        use_gpu=use_gpu,
        preferred_encoder=preferred_encoder,
    )
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.start()
    return worker
