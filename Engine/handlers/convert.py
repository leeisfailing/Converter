"""Convert command handler."""
from Engine.core.ipc import send_progress, send_finished
from Engine.core.security import validate_file_exists, validate_output_path, validate_string
from Engine.workers.converter import ConverterWorker


def handle_start_convert(cmd_args: dict):
    try:
        input_path = cmd_args["input"]
        output_path = cmd_args["output"]
        output_format = cmd_args["format"]
    except KeyError as e:
        send_finished(False, f"Missing required field: {e}", "")
        return None
    try:
        input_path = validate_file_exists(input_path, "input")
        output_path = validate_output_path(output_path, "output")
        validate_string(output_format, "format", 64)
    except ValueError as e:
        send_finished(False, str(e), "")
        return None
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
    return worker
