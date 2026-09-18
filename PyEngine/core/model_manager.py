"""ONNX model download, session management, and result caching.

Three-layer cache:
  1. Model cache  – downloaded .onnx files on disk (persistent across runs)
  2. Session cache – live ONNX InferenceSession objects (in-process reuse)
  3. Result cache – content-hash keyed enhanced outputs (avoids re-processing)
"""
import hashlib
import json
import os
import shutil
import sys
import threading
import urllib.request
import ssl
import tempfile
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Directories
# ---------------------------------------------------------------------------

_MODELS_DIR = Path(tempfile.gettempdir()) / "converter_ai_models"
_RESULT_CACHE_DIR = Path(tempfile.gettempdir()) / "converter_ai_results"
_RESULT_CACHE_INDEX = _RESULT_CACHE_DIR / "_index.json"
_MAX_RESULT_CACHE_ENTRIES = 64
_RESULT_CACHE_TTL_SECS = 7 * 24 * 3600  # 7 days

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

MODEL_REGISTRY = {
    "realesrgan-x4plus": {
        "url": "https://huggingface.co/qualcomm/Real-ESRGAN-x4plus/resolve/01179a4da7bf5ac91faca650e6afbf282ac93933/Real-ESRGAN-x4plus.onnx",
        "filename": "RealESRGAN_x4plus.onnx",
        "sha256": "",
        "scale": 4,
    },
    "realesrgan-x2plus": {
        "url": "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/Real-ESRGAN_x2plus.onnx",
        "filename": "RealESRGAN_x2plus.onnx",
        "sha256": "",
        "scale": 2,
    },
    "realesr-general-x4v3": {
        "url": "https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx",
        "filename": "realesr-general-x4v3.onnx",
        "sha256": "",
        "scale": 4,
    },
}

# ---------------------------------------------------------------------------
# Model cache – disk
# ---------------------------------------------------------------------------

def get_models_dir() -> Path:
    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    return _MODELS_DIR


def get_model_path(model_name: str) -> Path:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model_name}. Available: {', '.join(MODEL_REGISTRY)}")
    return get_models_dir() / MODEL_REGISTRY[model_name]["filename"]


def is_model_downloaded(model_name: str) -> bool:
    path = get_model_path(model_name)
    return path.exists() and path.stat().st_size > 1024 * 1024


def download_model(model_name: str, on_progress=None) -> Path:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model_name}")

    info = MODEL_REGISTRY[model_name]
    dest = get_models_dir() / info["filename"]

    if dest.exists() and dest.stat().st_size > 1024 * 1024:
        if on_progress:
            on_progress(100)
        return dest

    tmp_path = dest.with_suffix(".tmp")
    ctx = ssl.create_default_context()
    req = urllib.request.Request(info["url"], headers={"User-Agent": "Converter/1.0"})

    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            total = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            sha = hashlib.sha256()
            with open(tmp_path, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    sha.update(chunk)
                    downloaded += len(chunk)
                    if on_progress and total > 0:
                        on_progress(min(100.0, downloaded * 100.0 / total))

        file_hash = sha.hexdigest()
        expected = info.get("sha256", "")
        if expected and len(expected) == 64 and all(c in "0123456789abcdef" for c in expected):
            if file_hash != expected:
                tmp_path.unlink(missing_ok=True)
                raise RuntimeError(
                    f"Model {model_name} SHA256 mismatch: expected {expected}, got {file_hash}"
                )

        tmp_path.rename(dest)
        print(f"\n  Model saved: {dest}", file=sys.stderr, flush=True)
        return dest

    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise RuntimeError(f"Failed to download model {model_name}: {e}") from e


def ensure_model(model_name: str, on_progress=None) -> Path:
    if not is_model_downloaded(model_name):
        return download_model(model_name, on_progress=on_progress)
    if on_progress:
        on_progress(100)
    return get_model_path(model_name)


def list_available_models() -> list:
    return [
        {
            "name": name,
            "scale": info["scale"],
            "downloaded": is_model_downloaded(name),
            "path": str(get_model_path(name)) if is_model_downloaded(name) else None,
        }
        for name, info in MODEL_REGISTRY.items()
    ]


# ---------------------------------------------------------------------------
# Session cache – live ONNX sessions keyed by (model_name, providers_tuple)
# ---------------------------------------------------------------------------

_session_lock = threading.Lock()
_sessions: dict = {}


def get_session(model_name: str, use_gpu: bool = False, selected_gpu: str = ""):
    """Return a cached ONNX InferenceSession, creating one if needed.

    selected_gpu: GPU encoder name (e.g. "h264_nvenc") or empty for auto.
                  Used to extract device_id for CUDA; for DML the first
                  available device is used.
    """
    import onnxruntime as ort

    providers = ["CPUExecutionProvider"]
    if use_gpu:
        try:
            available = ort.get_available_providers()
            if "DmlExecutionProvider" in available:
                providers.insert(0, "DmlExecutionProvider")
            elif "CUDAExecutionProvider" in available:
                providers.insert(0, "CUDAExecutionProvider")
        except Exception:
            pass

    cache_key = (model_name, tuple(providers), selected_gpu)

    with _session_lock:
        session = _sessions.get(cache_key)
        if session is not None:
            return session

    model_path = ensure_model(model_name)
    session = ort.InferenceSession(str(model_path), providers=providers)

    with _session_lock:
        existing = _sessions.get(cache_key)
        if existing is not None:
            return existing
        _sessions[cache_key] = session
        return session


def clear_sessions():
    with _session_lock:
        _sessions.clear()


# ---------------------------------------------------------------------------
# Result cache – content-hash keyed enhanced output paths (disk-persistent)
# ---------------------------------------------------------------------------

_result_cache_lock = threading.Lock()


def _load_result_index() -> dict:
    try:
        if _RESULT_CACHE_INDEX.exists():
            data = json.loads(_RESULT_CACHE_INDEX.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except (json.JSONDecodeError, OSError):
        pass
    return {}


def _save_result_index(index: dict):
    _RESULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _RESULT_CACHE_INDEX.write_text(json.dumps(index), encoding="utf-8")


def _evict_old_entries(index: dict):
    now = time.time()
    expired = [
        k for k, v in index.items()
        if now - v.get("ts", 0) > _RESULT_CACHE_TTL_SECS
    ]
    for k in expired:
        entry = index.pop(k, None)
        if entry and entry.get("path"):
            try:
                _remove_cached_file(entry["path"])
            except OSError:
                pass

    while len(index) > _MAX_RESULT_CACHE_ENTRIES:
        oldest_key = min(index, key=lambda k: index[k].get("ts", 0))
        entry = index.pop(oldest_key, None)
        if entry and entry.get("path"):
            try:
                _remove_cached_file(entry["path"])
            except OSError:
                pass


def _content_hash(file_path: str, extra: str = "") -> str:
    sha = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            sha.update(chunk)
    size = os.path.getsize(file_path)
    sha.update(str(size).encode())
    if extra:
        sha.update(extra.encode())
    return sha.hexdigest()


def _remove_cached_file(path: str):
    # Older indexes point at user outputs. They must never be deleted.
    candidate = Path(path).resolve()
    if candidate.parent == _RESULT_CACHE_DIR.resolve() and candidate.name != _RESULT_CACHE_INDEX.name:
        candidate.unlink(missing_ok=True)


def get_cached_result(input_path: str, model_name: str, tile_size: int, output_format: str = "") -> str | None:
    key = _content_hash(input_path, f"v2:{model_name}:{tile_size}:{output_format.lower()}")
    with _result_cache_lock:
        index = _load_result_index()
        entry = index.get(key)
        if entry and entry.get("path"):
            result_path = Path(entry["path"])
            if (result_path.resolve().parent == _RESULT_CACHE_DIR.resolve()
                    and result_path.is_file() and result_path.stat().st_size > 0):
                if time.time() - entry.get("ts", 0) < _RESULT_CACHE_TTL_SECS:
                    return str(result_path)
    return None


def store_result(input_path: str, output_path: str, model_name: str, tile_size: int):
    suffix = Path(output_path).suffix.lower()
    key = _content_hash(input_path, f"v2:{model_name}:{tile_size}:{suffix}")
    with _result_cache_lock:
        _RESULT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cached = _RESULT_CACHE_DIR / f"{key}{suffix}"
        with tempfile.NamedTemporaryFile(dir=_RESULT_CACHE_DIR, delete=False) as temporary:
            temporary_path = Path(temporary.name)
        try:
            shutil.copyfile(output_path, temporary_path)
            os.replace(temporary_path, cached)
        finally:
            temporary_path.unlink(missing_ok=True)
        index = _load_result_index()
        index[key] = {
            "path": str(cached),
            "ts": time.time(),
            "model": model_name,
            "tile": tile_size,
        }
        _evict_old_entries(index)
        _save_result_index(index)


def clear_result_cache():
    with _result_cache_lock:
        index = _load_result_index()
        for entry in index.values():
            if entry.get("path"):
                try:
                    _remove_cached_file(entry["path"])
                except OSError:
                    pass
        _save_result_index({})


def get_cache_stats() -> dict:
    with _result_cache_lock:
        index = _load_result_index()
    return {
        "entries": len(index),
        "max_entries": _MAX_RESULT_CACHE_ENTRIES,
        "ttl_days": _RESULT_CACHE_TTL_SECS // 86400,
        "models_dir": str(_MODELS_DIR),
        "results_dir": str(_RESULT_CACHE_DIR),
    }
