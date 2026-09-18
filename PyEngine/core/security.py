"""Input sanitization utilities for handlers."""
import ipaddress
import math
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

MAX_PATH_LENGTH = 2048
MAX_URL_LENGTH = 2048
MAX_STRING_LENGTH = 4096
MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024  # 10GB
DANGEROUS_COMMAND_CHARS = re.compile(r'[;&|`$\\]')
# URL query parameters use ampersands; URLs are passed to APIs, not a shell.
DANGEROUS_URL_CHARS = re.compile(r'[;|`$\\]')
# Paths are passed to filesystem APIs and subprocess argument arrays; a
# backslash is a Windows directory separator, not a shell escape here.
DANGEROUS_PATH_CHARS = re.compile(r'[;&|`$]')


def validate_no_null_bytes(value: str, field_name: str = "input") -> None:
    if "\x00" in value:
        raise ValueError(f"Null bytes not allowed in {field_name}")


def validate_path(path_str: str, field_name: str = "path") -> str:
    validate_no_null_bytes(path_str, field_name)
    if len(path_str) > MAX_PATH_LENGTH:
        raise ValueError(f"{field_name} exceeds maximum length of {MAX_PATH_LENGTH}")
    if not path_str.strip():
        raise ValueError(f"{field_name} cannot be empty")
    if ".." in path_str:
        raise ValueError(f"{field_name} contains invalid path traversal")
    if DANGEROUS_PATH_CHARS.search(path_str):
        raise ValueError(f"{field_name} contains dangerous characters")
    resolved = Path(path_str).resolve()
    resolved_str = str(resolved)
    if ".." in resolved_str:
        raise ValueError(f"{field_name} contains invalid path traversal after canonicalization")
    return resolved_str


def validate_file_exists(path_str: str, field_name: str = "path") -> str:
    validated = validate_path(path_str, field_name)
    if not os.path.isfile(validated):
        raise ValueError(f"File not found: {validated}")
    try:
        size = os.path.getsize(validated)
        if size > MAX_FILE_SIZE:
            raise ValueError(f"File exceeds maximum allowed size ({MAX_FILE_SIZE // (1024**3)}GB)")
    except OSError:
        pass
    return validated


def validate_output_path(path_str: str, field_name: str = "path") -> str:
    validated = validate_path(path_str, field_name)
    parent = Path(validated).parent
    if not parent.exists():
        raise ValueError(f"Output directory does not exist: {parent}")
    filename = Path(validated).name
    if not filename or filename in ('.', '..'):
        raise ValueError(f"Invalid filename in {field_name}")
    return validated


def validate_url(url: str) -> str:
    validate_no_null_bytes(url, "url")
    if len(url) > MAX_URL_LENGTH:
        raise ValueError(f"URL exceeds maximum length of {MAX_URL_LENGTH}")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"URL scheme must be http or https, got: {parsed.scheme or 'none'}")
    if not parsed.hostname:
        raise ValueError("URL must have a valid hostname")
    hostname = parsed.hostname.lower()
    blocked_hosts = ("localhost", "0.0.0.0", "::1", "169.254.169.254")
    if hostname in blocked_hosts:
        raise ValueError(f"URL hostname is not allowed: {parsed.hostname}")
    try:
        ip = ipaddress.ip_address(hostname)
        if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local or ip.is_multicast or ip.is_unspecified or ip.is_benchmark:
            raise ValueError(f"URL hostname resolves to a private/reserved IP: {hostname}")
    except ValueError as e:
        if "resolves to a private" in str(e):
            raise
        pass
    if DANGEROUS_URL_CHARS.search(url):
        raise ValueError("URL contains dangerous characters")
    return url


def validate_output_dir(dir_str: str) -> str:
    validate_no_null_bytes(dir_str, "output_dir")
    if len(dir_str) > MAX_PATH_LENGTH:
        raise ValueError(f"output_dir exceeds maximum length of {MAX_PATH_LENGTH}")
    if DANGEROUS_PATH_CHARS.search(dir_str):
        raise ValueError("output_dir contains dangerous characters")
    resolved = Path(dir_str).resolve()
    if not resolved.is_dir():
        raise ValueError(f"Output directory does not exist: {resolved}")
    return str(resolved)


def validate_string(value: str, field_name: str, max_length: int = MAX_STRING_LENGTH) -> str:
    validate_no_null_bytes(value, field_name)
    if len(value) > max_length:
        raise ValueError(f"{field_name} exceeds maximum length of {max_length}")
    if DANGEROUS_COMMAND_CHARS.search(value):
        raise ValueError(f"{field_name} contains dangerous characters")
    return value


def validate_json_value(value: dict, max_depth: int = 10, current_depth: int = 0) -> None:
    if current_depth > max_depth:
        raise ValueError(f"JSON nesting exceeds maximum depth of {max_depth}")
    if isinstance(value, dict):
        for k, v in value.items():
            if not isinstance(k, str) or len(k) > 256:
                raise ValueError("JSON key too long")
            validate_json_value(v, max_depth, current_depth + 1)
    elif isinstance(value, list):
        if len(value) > 1024:
            raise ValueError("JSON array too large")
        for item in value:
            validate_json_value(item, max_depth, current_depth + 1)
    elif isinstance(value, str):
        if len(value) > 65536:
            raise ValueError("JSON string too large")
    elif isinstance(value, (int, float)):
        if math.isinf(value) or math.isnan(value):
            raise ValueError("Invalid JSON numeric value: NaN or Infinity not allowed")


def sanitize_ffmpeg_args(args: str) -> str:
    if not args:
        return args
    if len(args) > 2048:
        raise ValueError("ffmpeg_override exceeds maximum length")
    if DANGEROUS_COMMAND_CHARS.search(args):
        raise ValueError("ffmpeg_override contains dangerous characters")
    return args


def safe_open(path: str, mode: str = "r", **kwargs) -> object:
    validated = validate_path(path, "path")
    return open(validated, mode, **kwargs)


def validate_cookies_file(path: str) -> str:
    if not path:
        return ""
    validated = validate_path(path, "cookies_file")
    if not os.path.isfile(validated):
        return ""
    return validated


def validate_download_format(format_type: str) -> str:
    allowed_formats = [
        "tiktok", "tiktok_no_watermark",
        # MP4 video
        "mp4_2160", "mp4_1440", "mp4_1080", "mp4_720", "mp4_480", "mp4_360", "mp4_240",
        "mp4",
        # WebM video
        "webm_2160", "webm_1440", "webm_1080", "webm_720", "webm_480", "webm_360", "webm_240",
        "webm",
        # MKV video
        "mkv_2160", "mkv_1440", "mkv_1080", "mkv_720", "mkv_480", "mkv_360", "mkv_240",
        "mkv",
        # MP3 audio
        "mp3_320", "mp3_256", "mp3_192", "mp3_128", "mp3_64", "mp3",
        # WAV audio
        "wav",
        # FLAC audio
        "flac",
        # AAC audio
        "aac_320", "aac_256", "aac_192", "aac_128", "aac_64", "aac",
        # OGG audio
        "ogg_320", "ogg_256", "ogg_192", "ogg_128", "ogg_64", "ogg",
        # Fallbacks
        "bestvideo+bestaudio/best", "best", "worst", "original"
    ]
    if format_type not in allowed_formats:
        raise ValueError(f"Invalid format type: {format_type}")
    return format_type
