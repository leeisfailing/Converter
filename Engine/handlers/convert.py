"""Convert command handler."""
from Engine.core.ipc import send_progress, send_finished
from Engine.workers.converter import ConverterWorker


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
    return worker
