"""File type detection and allowed formats."""
from pathlib import Path
from Engine.formats.video import VIDEO_EXTENSIONS, VIDEO_OUTPUT_FORMATS
from Engine.formats.photo import PHOTO_EXTENSIONS, PHOTO_OUTPUT_FORMATS


def detect_file_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    if ext in VIDEO_EXTENSIONS:
        return 'video'
    elif ext in PHOTO_EXTENSIONS:
        return 'photo'
    return 'unknown'


def get_allowed_output_formats(file_type: str, dev_mode: bool = False) -> dict:
    if dev_mode:
        all_formats = {}
        all_formats.update(VIDEO_OUTPUT_FORMATS)
        all_formats.update(PHOTO_OUTPUT_FORMATS)
        return all_formats

    if file_type == 'video':
        return dict(VIDEO_OUTPUT_FORMATS)
    elif file_type == 'photo':
        return dict(PHOTO_OUTPUT_FORMATS)
    return {}
