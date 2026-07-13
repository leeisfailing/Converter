"""File type detection and allowed formats."""
from pathlib import Path
from Engine.formats.video import VIDEO_EXTENSIONS, VIDEO_OUTPUT_FORMATS
from Engine.formats.photo import PHOTO_EXTENSIONS, PHOTO_OUTPUT_FORMATS


_PHOTO_MAGICS = [
    b'\xff\xd8\xff',          # JPEG
    b'\x89PNG',               # PNG
    b'GIF8',                  # GIF
    b'BM',                    # BMP
    b'II\x2a\x00',           # TIFF little-endian
    b'MM\x00\x2a',           # TIFF big-endian
]

_VIDEO_MAGICS = [
    b'FLV\x01',              # FLV
    b'\x1a\x45\xdf\xa3',    # MKV / WebM (EBML header)
    b'\x47',                  # MPEG-TS sync byte
]


def _detect_from_content(file_path: str) -> str:
    try:
        with open(file_path, 'rb') as f:
            header = f.read(32)
    except (OSError, IOError):
        return None

    if len(header) < 4:
        return None

    for magic in _PHOTO_MAGICS:
        if header.startswith(magic):
            return 'photo'

    for magic in _VIDEO_MAGICS:
        if header.startswith(magic):
            return 'video'

    if header.startswith(b'RIFF') and len(header) >= 12:
        riff_subtype = header[8:12]
        if riff_subtype in (b'WEBP ',):
            return 'photo'
        if riff_subtype in (b'AVI ', b'AVI\x1a'):
            return 'video'

    if header[4:8] == b'ftyp' and len(header) >= 12:
        brand = header[8:12]
        heif_brands = {b'heic', b'heix', b'mif1', b'heim', b'heis', b'hevc'}
        if brand in heif_brands:
            return 'photo'
        if brand in (b'avif', b'avis'):
            return 'photo'
        return 'video'

    if header.startswith(b'OggS'):
        return 'video'

    return None


def detect_file_type(file_path: str) -> str:
    ext = Path(file_path).suffix.lower()
    ext_type = None
    if ext in VIDEO_EXTENSIONS:
        ext_type = 'video'
    elif ext in PHOTO_EXTENSIONS:
        ext_type = 'photo'

    content_type = _detect_from_content(file_path)
    if content_type is not None:
        return content_type

    return ext_type or 'unknown'


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
