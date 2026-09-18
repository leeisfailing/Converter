"""Photo format definitions."""
PHOTO_EXTENSIONS = {
    '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff',
    '.tif', '.svg', '.ico', '.heic', '.heif', '.avif',
}

PHOTO_OUTPUT_FORMATS = {
    'jpg': {'ext': '.jpg', 'quality': '2'},
    'jpeg': {'ext': '.jpeg', 'quality': '2'},
    'png': {'ext': '.png', 'compression': '3'},
    'webp': {'ext': '.webp', 'quality': '80'},
    'bmp': {'ext': '.bmp'},
    'gif': {'ext': '.gif'},
    'tiff': {'ext': '.tiff'},
    'tif': {'ext': '.tif'},
    'avif': {'ext': '.avif', 'quality': '30'},
}
