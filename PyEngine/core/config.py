"""Resource path helpers."""
import sys
import shutil
from functools import lru_cache
from pathlib import Path


def resource_path(relative: str) -> Path:
    if getattr(sys, 'frozen', False):
        # PyInstaller sets sys._MEIPASS to a temp extraction directory.
        base = Path(sys._MEIPASS)
    else:
        # Both source and Tauri resources retain PyEngine/core/config.py.
        # sys.executable points to the embedded Python in PyEngine/bin/python,
        # not the Tauri application executable or its resource directory.
        base = Path(__file__).resolve().parent.parent
    return base / relative


@lru_cache(maxsize=None)
def find_binary(name: str) -> str:
    """Look in bundled and development locations before using PATH."""
    base = resource_path("")
    names = (
        (f"{name}.exe", name)
        if sys.platform == "win32" and not name.lower().endswith(".exe")
        else (name,)
    )
    exe_dir = Path(sys.executable).parent

    # Tauri strips the build target suffix from externalBin sidecars when
    # installing them. Prefer resources shipped with this PyEngine instance.
    search_dirs = [
        base / "bin",  # PyEngine/bin, including Tauri's resource mapping
        base,          # PyInstaller may place binaries directly in _MEIPASS
        base.parent,   # Windows Tauri sidecars next to the PyEngine directory
        exe_dir,       # PyInstaller executable neighbours
    ]
    if name.lower() in ("vspipe", "vspipe.exe"):
        # Use the executable from the same VapourSynth wheel as embedded
        # Python, before any older standalone media binary in PyEngine/bin.
        package = Path("Lib/site-packages/vapoursynth")
        search_dirs[:0] = [
            base / "bin" / "python" / package,
            exe_dir / package,
            base.parent / "rust" / "src-tauri" / "bin" / "python" / package,
        ]
    for directory in search_dirs:
        for candidate in names:
            path = directory / candidate
            if path.is_file():
                return str(path)
    # Source checkouts use the target-suffixed executables prepared for Tauri.
    if sys.platform == 'win32' and name.lower() in ('ffmpeg', 'ffprobe', 'ffmpeg.exe', 'ffprobe.exe'):
        stem = name.lower().removesuffix('.exe')
        sidecar = base.parent / 'rust/src-tauri/bin' / f'{stem}-x86_64-pc-windows-msvc.exe'
        if sidecar.is_file():
            return str(sidecar)
    return shutil.which(name) or name
