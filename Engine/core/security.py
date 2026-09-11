"""Input sanitization utilities for handlers."""
import ipaddress
import os
from pathlib import Path
from urllib.parse import urlparse

MAX_PATH_LENGTH = 2048
MAX_URL_LENGTH = 2048
MAX_STRING_LENGTH = 4096


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
    resolved = Path(path_str).resolve()
    return str(resolved)


def validate_file_exists(path_str: str, field_name: str = "path") -> str:
    validated = validate_path(path_str, field_name)
    if not os.path.isfile(validated):
        raise ValueError(f"File not found: {validated}")
    return validated


def validate_output_path(path_str: str, field_name: str = "path") -> str:
    validated = validate_path(path_str, field_name)
    parent = Path(validated).parent
    if not parent.exists():
        raise ValueError(f"Output directory does not exist: {parent}")
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
        if ip.is_private or ip.is_loopback or ip.is_reserved or ip.is_link_local or ip.is_multicast:
            raise ValueError(f"URL hostname resolves to a private/reserved IP: {hostname}")
    except ValueError as e:
        if "resolves to a private" in str(e):
            raise
        pass
    return url


def validate_output_dir(dir_str: str) -> str:
    validate_no_null_bytes(dir_str, "output_dir")
    if len(dir_str) > MAX_PATH_LENGTH:
        raise ValueError(f"output_dir exceeds maximum length of {MAX_PATH_LENGTH}")
    resolved = Path(dir_str).resolve()
    if not resolved.is_dir():
        raise ValueError(f"Output directory does not exist: {resolved}")
    return str(resolved)


def validate_string(value: str, field_name: str, max_length: int = MAX_STRING_LENGTH) -> str:
    validate_no_null_bytes(value, field_name)
    if len(value) > max_length:
        raise ValueError(f"{field_name} exceeds maximum length of {max_length}")
    return value
