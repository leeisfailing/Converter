"""Audio format definitions."""
AUDIO_EXTENSIONS = {
    '.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a',
    '.opus', '.aiff', '.alac', '.ape', '.wv', '.mid', '.midi',
}

AUDIO_OUTPUT_FORMATS = {
    'mp3': {'ext': '.mp3', 'acodec': 'libmp3lame', 'bitrate': '192k'},
    'wav': {'ext': '.wav', 'acodec': 'pcm_s16le'},
    'flac': {'ext': '.flac', 'acodec': 'flac'},
    'aac': {'ext': '.aac', 'acodec': 'aac', 'bitrate': '192k'},
    'ogg': {'ext': '.ogg', 'acodec': 'libvorbis', 'bitrate': '192k'},
    'wma': {'ext': '.wma', 'acodec': 'wmav2', 'bitrate': '192k'},
    'm4a': {'ext': '.m4a', 'acodec': 'aac', 'bitrate': '192k'},
    'opus': {'ext': '.opus', 'acodec': 'libopus', 'bitrate': '128k'},
}
