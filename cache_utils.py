"""
Cache system for the Converter app.
Provides persistent caching for expensive operations like video metadata probing.
"""

import json
import hashlib
import os
from pathlib import Path
from typing import Any, Dict, Optional
from dataclasses import dataclass, asdict


@dataclass
class VideoMetadata:
    duration: Optional[float]
    size_bytes: Optional[int]
    format: Optional[str]
    width: Optional[int]
    height: Optional[int]


class CacheManager:
    def __init__(self, cache_dir: Path = None):
        if cache_dir is None:
            # Use app directory for cache
            cache_dir = Path(__file__).parent / "cache"
        self.cache_dir = cache_dir
        self.cache_dir.mkdir(exist_ok=True)
        self.metadata_cache_file = self.cache_dir / "video_metadata.json"
        self.url_cache_file = self.cache_dir / "url_cache.json"

        # Load caches
        self.metadata_cache: Dict[str, Dict[str, Any]] = self._load_cache(self.metadata_cache_file)
        self.url_cache: Dict[str, str] = self._load_cache(self.url_cache_file)

    def _load_cache(self, cache_file: Path) -> Dict[str, Any]:
        """Load cache from JSON file."""
        if cache_file.exists():
            try:
                with open(cache_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except (json.JSONDecodeError, OSError):
                return {}
        return {}

    def _save_cache(self, cache_file: Path, data: Dict[str, Any]):
        """Save cache to JSON file."""
        try:
            with open(cache_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except OSError:
            pass  # Silently fail if can't write

    def _get_file_hash(self, file_path: Path) -> str:
        """Get a hash of the file for cache key."""
        try:
            stat = file_path.stat()
            # Use path + mtime + size for hash
            key = f"{file_path}:{stat.st_mtime}:{stat.st_size}"
            return hashlib.md5(key.encode()).hexdigest()
        except OSError:
            return str(file_path)

    def get_video_metadata(self, file_path: Path) -> Optional[VideoMetadata]:
        """Get cached video metadata for a file."""
        cache_key = self._get_file_hash(file_path)
        if cache_key in self.metadata_cache:
            data = self.metadata_cache[cache_key]
            return VideoMetadata(**data)
        return None

    def set_video_metadata(self, file_path: Path, metadata: VideoMetadata):
        """Cache video metadata for a file."""
        cache_key = self._get_file_hash(file_path)
        self.metadata_cache[cache_key] = asdict(metadata)
        self._save_cache(self.metadata_cache_file, self.metadata_cache)

    def get_file_size(self, file_path: Path) -> Optional[int]:
        """Get cached file size."""
        cached = self.get_video_metadata(file_path)
        if cached and cached.size_bytes is not None:
            return cached.size_bytes
        try:
            size = file_path.stat().st_size
            # Update cache
            metadata = cached or VideoMetadata(duration=None, size_bytes=size, format=None, width=None, height=None)
            metadata.size_bytes = size
            self.set_video_metadata(file_path, metadata)
            return size
        except OSError:
            return None

    def get_cached_download_path(self, url: str) -> Optional[str]:
        """Get cached download path for a URL."""
        return self.url_cache.get(url)

    def set_cached_download_path(self, url: str, file_path: str):
        """Cache download path for a URL."""
        self.url_cache[url] = file_path
        self._save_cache(self.url_cache_file, self.url_cache)

    def clear_cache(self):
        """Clear all caches."""
        self.metadata_cache.clear()
        self.url_cache.clear()
        try:
            os.remove(self.metadata_cache_file)
            os.remove(self.url_cache_file)
        except OSError:
            pass


# Global cache manager instance
_cache_manager: Optional[CacheManager] = None

def get_cache_manager() -> CacheManager:
    """Get the global cache manager instance."""
    global _cache_manager
    if _cache_manager is None:
        _cache_manager = CacheManager()
    return _cache_manager