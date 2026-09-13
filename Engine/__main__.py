"""Engine entry point - JSON-RPC command dispatcher."""
import json
import sys
import traceback
import os
from importlib import import_module
from functools import lru_cache
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from Engine.core.ipc import send_response
from Engine.core.security import validate_json_value

_current_worker: dict = {}
_max_workers = 1
_command_timeout = 300


def handle_cancel():
    for key in list(_current_worker.keys()):
        worker = _current_worker.pop(key, None)
        if worker is not None:
            worker.stop()
            if hasattr(worker, '_thread') and worker._thread is not None:
                worker._thread.join(timeout=5)
    send_response({"ok": True})


HANDLERS = {
    "detect_file": ("file", "handle_detect_file"),
    "detect_url": ("url", "handle_detect_url"),
    "start_convert": ("convert", "handle_start_convert"),
    "start_download": ("download", "handle_start_download"),
    "start_reduce": ("reduce", "handle_start_reduce"),
}


@lru_cache(maxsize=None)
def _load_handler(cmd):
    module, name = HANDLERS[cmd]
    return getattr(import_module(f"Engine.handlers.{module}"), name)


def _store_worker(key: str, worker):
    if worker is not None:
        _current_worker[key] = worker


def _cleanup_workers():
    for key in list(_current_worker.keys()):
        worker = _current_worker.pop(key, None)
        if worker is not None and hasattr(worker, '_thread') and worker._thread is not None:
            if worker._thread.is_alive():
                worker.stop()
                worker._thread.join(timeout=5)
    _current_worker.clear()


def run_interactive_mode():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            if not isinstance(msg, dict):
                send_response({"ok": False, "error": "Command must be a JSON object"})
                continue
            cmd = msg.get("cmd", "")
            if cmd == "cancel":
                handle_cancel()
            elif cmd in HANDLERS:
                try:
                    validate_json_value(msg, max_depth=10)
                except ValueError as e:
                    send_response({"ok": False, "error": str(e)})
                    continue
                worker = _load_handler(cmd)(msg)
                if cmd.startswith("start_"):
                    _store_worker(cmd, worker)
            else:
                send_response({"ok": False, "error": f"Unknown command: {cmd}"})
        except json.JSONDecodeError:
            send_response({"ok": False, "error": "Invalid JSON"})
        except RecursionError:
            send_response({"ok": False, "error": "Command nesting too deep"})
        except MemoryError:
            send_response({"ok": False, "error": "Out of memory processing command"})
        except Exception:
            send_response({
                "ok": False,
                "error": traceback.format_exc(),
            })

    _cleanup_workers()


def main():
    try:
        run_interactive_mode()
    except KeyboardInterrupt:
        _cleanup_workers()
        send_response({"ok": False, "error": "Interrupted"})
    except Exception:
        _cleanup_workers()
        try:
            send_response({"ok": False, "error": traceback.format_exc()})
        except Exception:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
