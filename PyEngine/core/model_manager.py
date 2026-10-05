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

# Both caches live under the *user's* cache root.  A predictable path inside
# the shared temp directory can be pre-created (or symlinked elsewhere) by
# another local account, which would make this process write to an arbitrary
# file.
_CACHE_APP_DIRNAME = "Converter"
_MODEL_DIR_NAME = "ai_models"
_RESULT_DIR_NAME = "ai_results"
# Owner-only permissions for the cache leaf directories on POSIX systems.
_CACHE_DIR_MODE = 0o700
# A stalled download must not block every thread waiting on the model lock.
_DOWNLOAD_TIMEOUT_SECS = 30  # matches workers/downloader.py

_RESULT_CACHE_INDEX_NAME = "_index.json"
_MAX_RESULT_CACHE_ENTRIES = 64
_RESULT_CACHE_TTL_SECS = 7 * 24 * 3600  # 7 days


def _account_tag() -> str:
    """Identifier that scopes a temp path to the current account."""
    if hasattr(os, "getuid"):
        return str(os.getuid())
    return os.environ.get("USERNAME") or "user"


def _cache_roots() -> list:
    """Candidate per-user cache roots, most specific first."""
    roots = []
    if os.name == "nt":
        local = os.environ.get("LOCALAPPDATA", "").strip()
        if local:
            roots.append(Path(local))
    else:
        xdg = os.environ.get("XDG_CACHE_HOME", "").strip()
        if xdg:
            roots.append(Path(xdg).expanduser())
    try:
        home = Path.home()
    except (OSError, RuntimeError):
        home = None
    if home is not None:
        roots.append(home / ".cache")
    # Last resort: a directory scoped to this account inside the shared temp
    # root (the Windows temp directory is already per-user).
    roots.append(Path(tempfile.gettempdir()) / f"converter_{_account_tag()}")
    return roots


def _prepare_cache_dir(path: Path) -> bool:
    """Create path with owner-only permissions, refusing anything unowned.

    Returns False instead of raising so callers can fall back to the next
    candidate location rather than trusting a directory another account
    created on our behalf.
    """
    try:
        if path.is_symlink():
            return False
        path.mkdir(parents=True, exist_ok=True)
        if os.name != "nt":
            if path.stat().st_uid != os.getuid():
                return False
            os.chmod(path, _CACHE_DIR_MODE)
    except OSError:
        return False
    return True


def _resolve_cache_dir(path: Path, name: str) -> Path:
    """Create path, falling back to the remaining per-user candidates."""
    if _prepare_cache_dir(path):
        return path
    for root in _cache_roots():
        candidate = root / _CACHE_APP_DIRNAME / name
        if _prepare_cache_dir(candidate):
            return candidate
    tried = ", ".join(str(root / _CACHE_APP_DIRNAME / name) for root in _cache_roots())
    raise RuntimeError(f"No usable cache directory for {name}; tried: {tried}")


_MODEL_CACHE_ROOT = _cache_roots()[0]
_MODELS_DIR = _MODEL_CACHE_ROOT / _CACHE_APP_DIRNAME / _MODEL_DIR_NAME
_RESULT_CACHE_DIR = _MODEL_CACHE_ROOT / _CACHE_APP_DIRNAME / _RESULT_DIR_NAME
_RESULT_CACHE_INDEX = _RESULT_CACHE_DIR / _RESULT_CACHE_INDEX_NAME

# ---------------------------------------------------------------------------
# Model registry
# ---------------------------------------------------------------------------

# sha256 values are the Git LFS object digests read from each source
# repository's API (tree entry "lfs.oid", cross-checked against the raw LFS
# pointer file) on 2026-10-03; the models themselves were not downloaded.
# Two URLs track a mutable branch: a future upstream replacement fails closed
# with a SHA256 mismatch until the digest is refreshed here.
MODEL_REGISTRY = {
    "realesrgan-x4plus": {
        "url": "https://huggingface.co/qualcomm/Real-ESRGAN-x4plus/resolve/01179a4da7bf5ac91faca650e6afbf282ac93933/Real-ESRGAN-x4plus.onnx",
        "filename": "RealESRGAN_x4plus.onnx",
        "sha256": "4e1ae0e47f80d9f4aa2a317c24fde2cb3e49a5381eed6e1d509b4001a4b97ad2",
        "scale": 4,
    },
    "realesrgan-x2plus": {
        "url": "https://huggingface.co/tidus2102/Real-ESRGAN/resolve/main/Real-ESRGAN_x2plus.onnx",
        "filename": "RealESRGAN_x2plus.onnx",
        "sha256": "735f42fd172779c9776606298b9f744d9d488f8aa1fe90fe6c6470186020a754",
        "scale": 2,
    },
    "realesr-general-x4v3": {
        "url": "https://huggingface.co/Heliosoph/realesrgan-onnx/resolve/main/realesr-general-x4v3.onnx",
        "filename": "realesr-general-x4v3.onnx",
        "sha256": "09b757accd747d7e423c1d352b3e8f23e77cc5742d04bae958d4eb8082b76fa4",
        "scale": 4,
    },
}

# ---------------------------------------------------------------------------
# Model cache – disk
# ---------------------------------------------------------------------------

def get_models_dir() -> Path:
    """Return the model cache directory, creating it on first use."""
    global _MODELS_DIR
    _MODELS_DIR = _resolve_cache_dir(_MODELS_DIR, _MODEL_DIR_NAME)
    return _MODELS_DIR


def get_model_path(model_name: str) -> Path:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model_name}. Available: {', '.join(MODEL_REGISTRY)}")
    return get_models_dir() / MODEL_REGISTRY[model_name]["filename"]


def is_model_downloaded(model_name: str) -> bool:
    path = get_model_path(model_name)
    return path.exists() and path.stat().st_size > 1024 * 1024


_download_locks = {name: threading.Lock() for name in MODEL_REGISTRY}


def download_model(model_name: str, on_progress=None) -> Path:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model_name}")
    with _download_locks[model_name]:
        return _download_model(model_name, on_progress)


def _is_sha256_hex(value: str) -> bool:
    """True when value is a lowercase 64-character hex SHA256 digest."""
    return len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def _download_model(model_name: str, on_progress=None) -> Path:
    if model_name not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model: {model_name}")

    info = MODEL_REGISTRY[model_name]
    dest = get_models_dir() / info["filename"]

    expected = str(info.get("sha256", "")).strip().lower()
    if not expected:
        # An unpinned digest must not break model loading, but it must never
        # look like verification happened either.
        print(f"[model] WARNING: no SHA256 digest pinned for {model_name}; "
              f"downloaded bytes cannot be verified", file=sys.stderr, flush=True)
    elif not _is_sha256_hex(expected):
        # A digest that is present but malformed must fail closed: accepting
        # it would silently disable the check it was meant to provide.
        raise RuntimeError(f"Model {model_name} has an invalid pinned SHA256: {expected!r}")

    if dest.is_file() and dest.stat().st_size > 1024 * 1024:
        cached_hash = hashlib.sha256()
        with dest.open("rb") as cached:
            for chunk in iter(lambda: cached.read(65536), b""):
                cached_hash.update(chunk)
        if not expected or cached_hash.hexdigest() == expected:
            if on_progress:
                on_progress(100)
            return dest
        print(f"[model] Cached {model_name} failed SHA256 verification; downloading a verified replacement",
              file=sys.stderr, flush=True)

    ctx = ssl.create_default_context()
    req = urllib.request.Request(info["url"], headers={"User-Agent": "Converter/1.0"})
    # A random, exclusively created file inside the per-user cache directory
    # cannot be planted as a symlink by another local account, unlike a
    # predictable "<name>.tmp" path.
    temporary = None
    sha = hashlib.sha256()
    try:
        with tempfile.NamedTemporaryFile(dir=dest.parent, delete=False) as handle:
            temporary = Path(handle.name)
            with urllib.request.urlopen(req, context=ctx,
                                        timeout=_DOWNLOAD_TIMEOUT_SECS) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                downloaded = 0
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    handle.write(chunk)
                    sha.update(chunk)
                    downloaded += len(chunk)
                    if on_progress and total > 0:
                        on_progress(min(100.0, downloaded * 100.0 / total))

        file_hash = sha.hexdigest()
        if expected and file_hash != expected:
            raise RuntimeError(
                f"Model {model_name} SHA256 mismatch: expected {expected}, got {file_hash}"
            )

        os.replace(temporary, dest)
        print(f"\n  Model saved: {dest}", file=sys.stderr, flush=True)
        return dest

    except Exception as e:
        raise RuntimeError(f"Failed to download model {model_name}: {e}") from e
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def ensure_model(model_name: str, on_progress=None) -> Path:
    # Session reuse avoids repeated hashing during frame processing. Every new
    # session must verify cached bytes before passing a model to ONNX Runtime.
    return download_model(model_name, on_progress=on_progress)


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
_session_build_locks: dict = {}


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

    # Serialize expensive construction per key while allowing unrelated models
    # to initialize concurrently. Waiting callers reuse the first session.
    with _session_lock:
        build_lock = _session_build_locks.setdefault(cache_key, threading.Lock())
    with build_lock:
        with _session_lock:
            session = _sessions.get(cache_key)
            if session is not None:
                return session
        model_path = ensure_model(model_name)
        session = ort.InferenceSession(str(model_path), providers=providers)
        with _session_lock:
            _sessions[cache_key] = session
        return session


def clear_sessions():
    with _session_lock:
        _sessions.clear()


# ---------------------------------------------------------------------------
# Result cache – content-hash keyed enhanced output paths (disk-persistent)
# ---------------------------------------------------------------------------

_result_cache_lock = threading.Lock()


def _result_cache_dir() -> Path:
    """Create and return the result cache directory.

    Raises OSError when no safe directory can be created so callers treat
    cache bookkeeping as unavailable instead of writing elsewhere.
    """
    if not _prepare_cache_dir(_RESULT_CACHE_DIR):
        raise OSError(f"Cannot create result cache directory: {_RESULT_CACHE_DIR}")
    return _RESULT_CACHE_DIR


def _load_result_index() -> dict:
    try:
        if _RESULT_CACHE_INDEX.exists():
            data = json.loads(_RESULT_CACHE_INDEX.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                # Entries written by hand or truncated by a crash can hold
                # non-dict values; drop them rather than crash later while
                # a finished job records its result.
                return {k: v for k, v in data.items() if isinstance(v, dict)}
    except (json.JSONDecodeError, OSError, UnicodeDecodeError):
        pass
    return {}


def _save_result_index(index: dict):
    directory = _result_cache_dir()
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8",
                                         dir=directory, delete=False) as temporary:
            temporary_path = Path(temporary.name)
            json.dump(index, temporary)
        os.replace(temporary_path, _RESULT_CACHE_INDEX)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _evict_old_entries(index: dict):
    # Malformed entries are dropped first so eviction can never raise on
    # them (index bookkeeping runs after a job already succeeded).
    for key in [k for k, v in index.items() if not isinstance(v, dict)]:
        del index[key]
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
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
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
    key = _content_hash(input_path, f"v3:{model_name}:{tile_size}:{output_format.lower()}")
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
    key = _content_hash(input_path, f"v3:{model_name}:{tile_size}:{suffix}")
    with _result_cache_lock:
        directory = _result_cache_dir()
        cached = directory / f"{key}{suffix}"
        with tempfile.NamedTemporaryFile(dir=directory, delete=False) as temporary:
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
