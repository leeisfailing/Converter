"""Prepare Linux sidecars, a relocatable private Python, and the native engine.

Run from any directory with Python 3.11+: python3 scripts/setup_linux.py
System dependencies are installed separately; this script never invokes sudo.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".runtime-downloads"
RUNTIME = ROOT / "rust/src-tauri/bin/linux/python"
REQUIREMENTS = ROOT / "PyEngine/requirements-linux.txt"
RELEASE = "20260929"
VERSION = "3.12.14"
# Official python-build-standalone release asset SHA-256 digests.
PYTHON_SHA256 = {
    "x86_64": "ef605200f8174e87ecfc308e52a88127543f85dd5c940dc5e92cab244b98a003",
    "aarch64": "706111f834ae1557314f48b7293ddc72cc96e952aa75c5d31f56c2b7ddeac3d3",
}


def host_target() -> str:
    arch = {"amd64": "x86_64", "arm64": "aarch64"}.get(platform.machine().lower(), platform.machine().lower())
    if sys.platform != "linux" or arch not in PYTHON_SHA256:
        raise RuntimeError("Linux setup supports x86_64 and aarch64 with glibc.")
    if platform.libc_ver()[0] != "glibc":
        raise RuntimeError("This Tauri Linux runtime requires glibc (not musl).")
    target = subprocess.check_output(["rustc", "-vV"], text=True)
    triple = next(line.removeprefix("host: ") for line in target.splitlines() if line.startswith("host: "))
    if triple != f"{arch}-unknown-linux-gnu":
        raise RuntimeError(f"Native Linux builds require {arch}-unknown-linux-gnu; found {triple}.")
    return triple


def prepare_tools(triple: str) -> None:
    for name in ("ffmpeg", "ffprobe"):
        source = shutil.which(name)
        if not source:
            raise RuntimeError(f"Install ffmpeg using your distribution's package manager: {name} is missing.")
        subprocess.run([source, "-version"], check=True, stdout=subprocess.DEVNULL, timeout=30)
        destination = ROOT / f"rust/src-tauri/bin/converter-{name}-{triple}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or Path(source).stat().st_mtime_ns > destination.stat().st_mtime_ns:
            shutil.copy2(source, destination)
        destination.chmod(destination.stat().st_mode | 0o111)


def prepare_python(triple: str) -> None:
    arch = triple.split("-", 1)[0]
    stamp = f"{VERSION}+{RELEASE}:{arch}:" + hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
    marker = RUNTIME / ".converter-runtime"
    if marker.is_file() and marker.read_text() == stamp and (RUNTIME / "bin/python3").is_file():
        return
    CACHE.mkdir(exist_ok=True)
    filename = f"cpython-{VERSION}+{RELEASE}-{triple}-install_only_stripped.tar.gz"
    archive_path = CACHE / filename
    if not archive_path.is_file() or hashlib.sha256(archive_path.read_bytes()).hexdigest() != PYTHON_SHA256[arch]:
        url = f"https://github.com/astral-sh/python-build-standalone/releases/download/{RELEASE}/{filename}"
        print(f"Downloading private Linux Python {VERSION}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            archive_path.write_bytes(response.read())
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != PYTHON_SHA256[arch]:
        raise RuntimeError("SHA-256 mismatch for Linux Python runtime")
    staging = Path(tempfile.mkdtemp(prefix="linux-python-", dir=CACHE))
    with tarfile.open(archive_path) as archive:
        archive.extractall(staging, filter="data")
    python = staging / "python/bin/python3"
    env = dict(os.environ)
    for key in ("PYTHONHOME", "PYTHONPATH"):
        env.pop(key, None)
    env["PIP_CACHE_DIR"] = str(CACHE / "pip")
    subprocess.run([str(python), "-I", "-B", "-m", "pip", "install", "--disable-pip-version-check",
                    "--only-binary=:all:", "-r", str(REQUIREMENTS)], check=True, env=env)
    subprocess.run([str(python), "-I", "-B", "-c",
                    "import ssl, sqlite3, yt_dlp, yt_dlp_ejs, deno, onnxruntime, cv2, numpy"], check=True, env=env)
    (staging / "python/.converter-runtime").write_text(stamp)
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    if RUNTIME.exists():
        shutil.move(str(RUNTIME), str(CACHE / f"previous-{staging.name}"))
    shutil.move(str(staging / "python"), str(RUNTIME))
    staging.rmdir()


def build_engine() -> None:
    build = ROOT / "cpp_engine/build-linux"
    # Respect the same explicit job budget as the Windows build script.
    jobs = int(os.environ.get("CMAKE_BUILD_PARALLEL_LEVEL") or min(os.cpu_count() or 2, 4))
    if jobs < 1:
        raise ValueError("CMAKE_BUILD_PARALLEL_LEVEL must be a positive integer.")
    subprocess.run(["cmake", "-S", str(ROOT / "cpp_engine"), "-B", str(build),
                    "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_TESTING=ON"], check=True)
    subprocess.run(["cmake", "--build", str(build), "--parallel", str(jobs)], check=True)


def main() -> None:
    try:
        triple = host_target()
        prepare_tools(triple)
        prepare_python(triple)
        build_engine()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Linux setup failed: {error}") from error
    print("Linux runtime and native engine ready.", flush=True)


if __name__ == "__main__":
    main()
