"""Engine entry point - JSON-RPC command dispatcher."""
import json
import sys
import traceback
from pathlib import Path

# Ensure the project root (parent of Engine/) is in sys.path
# so that "from Engine.xxx import yyy" resolves correctly
# when invoked as: python Engine/__main__.py
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from Engine.core.ipc import send_response
from Engine.handlers.file import handle_detect_file
from Engine.handlers.url import handle_detect_url
from Engine.handlers.convert import handle_start_convert
from Engine.handlers.download import handle_start_download

_current_worker: dict = {}


def handle_cancel():
    for key in list(_current_worker.keys()):
        worker = _current_worker.pop(key, None)
        if worker is not None:
            worker.stop()
    send_response({"ok": True})


HANDLERS = {
    "detect_file": handle_detect_file,
    "detect_url": handle_detect_url,
    "start_convert": lambda args: _store_worker("convert", handle_start_convert(args)),
    "start_download": lambda args: _store_worker("download", handle_start_download(args)),
    "cancel": lambda _: handle_cancel(),
}


def _store_worker(key: str, worker):
    if worker is not None:
        _current_worker[key] = worker


def run_interactive_mode():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            cmd = msg.get("cmd", "")
            handler = HANDLERS.get(cmd)
            if handler:
                handler(msg)
            else:
                send_response({"ok": False, "error": f"Unknown command: {cmd}"})
        except Exception:
            send_response({
                "ok": False,
                "error": traceback.format_exc(),
            })

    for key, worker in list(_current_worker.items()):
        if hasattr(worker, '_thread') and worker._thread is not None and worker._thread.is_alive():
            worker._thread.join()
    _current_worker.clear()


def main():
    run_interactive_mode()


if __name__ == "__main__":
    main()
