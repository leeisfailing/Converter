"""Download and assemble the pinned Windows x64 runtime used by Tauri.

Run with any host Python 3.11+: python scripts/bundle_runtime.py
No pip, registry changes, or machine-wide Python installation is required by the app.
"""
from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".runtime-downloads"
DESTINATION = ROOT / "rust/src-tauri/bin/python"
ARTIFACTS = (
    (
        "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
        "4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3",
        "",
    ),
    (
        "https://files.pythonhosted.org/packages/65/90/249eebf18d54998bb71929c9130a0d3f8130f47e250fa0d70e0cc406c3aa/vapoursynth-77-cp312-abi3-win_amd64.whl",
        "443b0a9c3481ba23331e21dcb3605375f08e7190b943606b4bc9f9f67efeceba",
        "Lib/site-packages",
    ),
    (
        "https://files.pythonhosted.org/packages/69/b2/8cd1613f56eed7ceb64fbd4df3f1c01246bfb098e6f398228bafda22b80b/yt_dlp-2026.8.19-py3-none-any.whl",
        "1d57897e94c6665a0a6f9bc54b34e584284e32c034ffab3a7df25d8f7b24eedf",
        "Lib/site-packages",
    ),
    (
        "https://files.pythonhosted.org/packages/e3/bd/520769863744b669440a924271a6159ddd82ad5ae26b4ac4d4b69e9f8d44/yt_dlp_ejs-0.8.0-py3-none-any.whl",
        "79300e5fca7f937a1eeede11f0456862c1b41107ce1d726871e0207424f4bdb4",
        "Lib/site-packages",
    ),
    (
        "https://files.pythonhosted.org/packages/7e/0b/3ca6468ec928d817ce6ef062ddfa11e71a3c68035c3401057d7cb33845f6/deno-2.9.5-py3-none-win_amd64.whl",
        "570d4ee6f1ddb16d14848d36dac6cd2f586d8a0c94cf9c3e6b5da130da2597d5",
        "Lib/site-packages",
    ),
)


def download(url: str, digest: str) -> Path:
    destination = CACHE / url.rsplit("/", 1)[-1]
    if not destination.exists() or hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        print(f"Downloading {destination.name}", flush=True)
        with urllib.request.urlopen(url, timeout=120) as response:
            destination.write_bytes(response.read())
    if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        raise RuntimeError(f"SHA-256 mismatch: {destination.name}")
    return destination


def main() -> None:
    if os.name != "nt":
        raise SystemExit("This runtime is for Windows x64; run setup on Windows.")
    CACHE.mkdir(exist_ok=True)
    # Build and validate separately so failed downloads never damage the current runtime.
    staging = Path(tempfile.mkdtemp(prefix="python-", dir=CACHE))
    for url, digest, relative in ARTIFACTS:
        with zipfile.ZipFile(download(url, digest)) as archive:
            archive.extractall(staging / relative)
            # Wheel script entries need relocation when installing without pip.
            for member in archive.namelist():
                if member.endswith('.data/scripts/deno.exe'):
                    (staging / 'deno.exe').write_bytes(archive.read(member))
    (staging / "python312._pth").write_text(
        "python312.zip\n.\nLib/site-packages\n../../../\nimport site\n", encoding="utf-8"
    )
    # Disable writes into Program Files while keeping embedded import isolation.
    (staging / "Lib/site-packages/sitecustomize.py").write_text(
        '"""Settings for the private Converter runtime."""\n'
        "import sys\nsys.dont_write_bytecode = True\n", encoding="utf-8"
    )
    clean_env = dict(os.environ)
    clean_env["PATH"] = str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32")
    for key in ("PYTHONHOME", "PYTHONPATH", "VSSCRIPT_PATH"):
        clean_env.pop(key, None)
    subprocess.run(
        [str(staging / "python.exe"), "-I", "-B", "-c",
         "import sys, ssl, sqlite3, yt_dlp.version, yt_dlp_ejs, vapoursynth as vs; "
         "assert sys.version_info[:2] == (3, 12); "
         "assert vs.core.std.BlankClip(width=16, height=16, length=1).get_frame(0).width == 16; "
         "print(sys.version); print('yt-dlp', yt_dlp.version.__version__); print(vs.__version__)"],
        cwd=CACHE, env=clean_env, check=True,
    )
    subprocess.run([str(staging / 'deno.exe'), '--version'],
                   cwd=CACHE, env=clean_env, check=True)
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    if DESTINATION.exists():
        # Retain the prior runtime locally, including any user-added files.
        backup = CACHE / ("previous-" + staging.name)
        if not DESTINATION.resolve().is_relative_to(ROOT) or not backup.resolve().is_relative_to(ROOT):
            raise RuntimeError("Runtime paths must remain inside the project")
        shutil.move(str(DESTINATION), str(backup))
    shutil.move(str(staging), str(DESTINATION))
    print(f"Bundled runtime ready: {DESTINATION}", flush=True)


if __name__ == "__main__":
    main()
