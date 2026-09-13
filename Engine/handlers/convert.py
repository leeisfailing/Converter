"""Convert command handler."""
import os
from pathlib import Path
from Engine.core.ipc import send_progress, send_finished
from Engine.core.security import validate_file_exists, validate_output_path, validate_string, validate_output_dir
from Engine.workers.converter import ConverterWorker
from Engine.formats.video import VIDEO_OUTPUT_FORMATS
from Engine.formats.audio import AUDIO_OUTPUT_FORMATS
from Engine.formats.photo import PHOTO_OUTPUT_FORMATS

ALLOWED_FORMATS = set(VIDEO_OUTPUT_FORMATS) | set(AUDIO_OUTPUT_FORMATS) | set(PHOTO_OUTPUT_FORMATS)


def handle_start_convert(cmd_args: dict):
    import sys
    print(f"[convert-handler] Received command: use_gpu={cmd_args.get('use_gpu')}, preferred_encoder={cmd_args.get('preferred_encoder')!r}", file=sys.stderr, flush=True)
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
    import sys
    print(f"[convert] raw args: input={input_path!r}, output={output_path!r}, format={output_format!r}", file=sys.stderr, flush=True)
    try:
        input_path = validate_file_exists(input_path, "input")
        output_path = validate_output_path(output_path, "output")
        print(f"[convert] validated: input={input_path!r}, output={output_path!r}", file=sys.stderr, flush=True)
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

    worker = ConverterWorker(
        input_path=input_path,
        output_path=output_path,
        output_format=output_format,
        dev_mode=dev_mode,
        use_gpu=use_gpu,
        preferred_encoder=preferred_encoder,
    )
    worker.on_progress = on_progress
    worker.on_finished = on_finished
    worker.start()
    return worker
