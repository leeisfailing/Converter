"""GPU detection handler."""
from PyEngine.core.ipc import send_response
from PyEngine.core.gpu import detect_gpu


def handle_detect_gpu(cmd_args: dict):
    try:
        info = detect_gpu()
        send_response({
            "ok": True,
            "available": info["available"],
            "encoder": info["encoder"],
            "vendor": info["vendor"],
            "hwaccel": info["hwaccel"],
            "name": info["name"],
            "message": info["message"],
            "all_encoders": info["all_encoders"],
        })
    except Exception as e:
        send_response({
            "ok": False,
            "available": False,
            "encoder": None,
            "vendor": None,
            "hwaccel": None,
            "name": None,
            "message": f"GPU detection failed: {e}",
            "all_encoders": [],
        })
