"""Enhance command handler – validates args, creates worker, wires callbacks."""
import os
from pathlib import Path

from PyEngine.core.ipc import send_progress, send_finished
from PyEngine.core.security import (
    validate_file_exists,
    validate_output_path,
    validate_string,
    validate_output_dir,
)
from PyEngine.core.model_manager import MODEL_REGISTRY
from PyEngine.workers.enhancer import EnhancerWorker

ALLOWED_TYPES = {"video", "photo"}
DEFAULT_TILE_SIZE = 256
MIN_TILE_SIZE = 64
MAX_TILE_SIZE = 512


def handle_start_enhance(cmd_args: dict):
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
    if not isinstance(file_type, str) or file_type.lower().strip() not in ALLOWED_TYPES:
        send_finished(False, f"file_type must be one of: {', '.join(sorted(ALLOWED_TYPES))}", "")
        return None

    file_type = file_type.lower().strip()

    model_name = cmd_args.get("model", "realesrgan-x4plus")
    if not isinstance(model_name, str) or model_name not in MODEL_REGISTRY:
        send_finished(False, f"Invalid model: {model_name}. Available: {', '.join(MODEL_REGISTRY)}", "")
        return None

    tile_size = cmd_args.get("tile_size", DEFAULT_TILE_SIZE)
    if not isinstance(tile_size, (int, float)) or not (MIN_TILE_SIZE <= tile_size <= MAX_TILE_SIZE):
        send_finished(False, f"tile_size must be between {MIN_TILE_SIZE} and {MAX_TILE_SIZE}", "")
        return None
    tile_size = int(tile_size)

    use_gpu = cmd_args.get("use_gpu", False)
    if not isinstance(use_gpu, bool):
        send_finished(False, "use_gpu must be a boolean", "")
        return None

    selected_gpu = cmd_args.get("selected_gpu", "")
    if not isinstance(selected_gpu, str):
        selected_gpu = ""

    try:
        input_path = validate_file_exists(input_path, "input")
        output_path = validate_output_path(output_path, "output")
        validate_string(file_type, "file_type", 32)
        validate_string(model_name, "model", 64)
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

    def on_progress(percent):
        send_progress(percent)

    def on_finished(ok, message, file_path):
        send_finished(ok, message, file_path)

    worker = EnhancerWorker(
        input_path=input_path,
        output_path=output_path,
        model_name=model_name,
        tile_size=tile_size,
        use_gpu=use_gpu,
        selected_gpu=selected_gpu,
    )
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.start()
    return worker
