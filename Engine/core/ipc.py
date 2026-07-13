"""JSON-RPC IPC communication."""
import json
import sys


def send_response(obj: dict):
    try:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    except (BrokenPipeError, OSError):
        pass


def send_progress(percent: int):
    send_response({"type": "progress", "percent": percent})


def send_finished(ok: bool, message: str = "", file_path: str = ""):
    send_response({"type": "finished", "ok": ok, "message": message, "file_path": file_path})


def send_download_status(percent=None, speed=None, eta=None, is_live=False, status=""):
    send_response({
        "type": "download_status",
        "percent": percent,
        "speed": speed,
        "eta": eta,
        "is_live": is_live,
        "status": status,
    })
