"""File detection handler."""
from Engine.core.ipc import send_response
from Engine.core.security import validate_file_exists, validate_no_null_bytes
from Engine.formats.detection import detect_file_type, get_allowed_output_formats


def handle_detect_file(cmd_args: dict):
    try:
        file_path = cmd_args["path"]
    except (KeyError, TypeError):
        send_response({"ok": False, "error": "Missing required field: path"})
        return
    try:
        validate_no_null_bytes(file_path, "path")
        file_path = validate_file_exists(file_path, "path")
    except ValueError as e:
        send_response({"ok": False, "error": str(e)})
        return
    file_type = detect_file_type(file_path)
    dev_mode = cmd_args.get("dev_mode", False)
    allowed = get_allowed_output_formats(file_type, dev_mode)
    send_response({
        "ok": True,
        "file_type": file_type,
        "allowed_formats": list(allowed.keys()),
    })
