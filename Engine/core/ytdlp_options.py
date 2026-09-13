"""Shared extractor support for detection and downloading on all platforms."""
from pathlib import Path

from Engine.core.config import find_binary


def javascript_options() -> dict:
    """Prefer the private runtime; allow installed runtimes in source checkouts."""
    deno = find_binary('deno')
    if Path(deno).is_file():
        return {'js_runtimes': {'deno': {'path': deno}}}
    node = find_binary('node')
    if Path(node).is_file():
        return {'js_runtimes': {'node': {'path': node}}}
    # Preserve yt-dlp's default discovery (including pip-installed Deno).
    return {}
