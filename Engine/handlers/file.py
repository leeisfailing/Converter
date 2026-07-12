"""File detection handler."""
from Engine.core.ipc import send_response
from Engine.formats.detection import detect_file_type, get_allowed_output_formats


def handle_detect_file(cmd_args: dict):
    file_path = cmd_args["path"]
    file_type = detect_file_type(file_path)
    dev_mode = cmd_args.get("dev_mode", False)
    allowed = get_allowed_output_formats(file_type, dev_mode)
    send_response({
        "ok": True,
        "file_type": file_type,
        "allowed_formats": list(allowed.keys()),
    })
