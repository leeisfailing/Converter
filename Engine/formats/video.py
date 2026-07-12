"""Video format definitions."""
VIDEO_EXTENSIONS = {
    '.mp4', '.mkv', '.avi', '.mov', '.webm', '.wmv', '.flv',
    '.m4v', '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.vob',
}

VIDEO_OUTPUT_FORMATS = {
    'mp4': {'ext': '.mp4', 'vcodec': 'libx264', 'acodec': 'aac'},
    'mkv': {'ext': '.mkv', 'vcodec': 'libx264', 'acodec': 'aac'},
    'avi': {'ext': '.avi', 'vcodec': 'libx264', 'acodec': 'mp3'},
    'mov': {'ext': '.mov', 'vcodec': 'libx264', 'acodec': 'aac'},
    'webm': {'ext': '.webm', 'vcodec': 'libvpx-vp9', 'acodec': 'libopus'},
    'wmv': {'ext': '.wmv', 'vcodec': 'wmv2', 'acodec': 'wmav2'},
    'flv': {'ext': '.flv', 'vcodec': 'libx264', 'acodec': 'aac'},
    'gif': {'ext': '.gif', 'vcodec': 'gif', 'acodec': None},
}
