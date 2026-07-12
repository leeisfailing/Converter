"""Resource path helpers."""
import sys
from pathlib import Path


def resource_path(relative: str) -> Path:
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS)
    else:
        base = Path(__file__).parent.parent
    return base / relative
