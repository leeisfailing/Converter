"""JSON-RPC IPC communication."""
import json
import sys


def send_response(obj: dict):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def send_progress(percent: int):
    send_response({"type": "progress", "percent": percent})


def send_finished(ok: bool, message: str = "", file_path: str = ""):
    send_response({"type": "finished", "ok": ok, "message": message, "file_path": file_path})
