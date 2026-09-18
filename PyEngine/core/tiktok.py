"""Independent TikTok resolver using TikWM. No yt-dlp or YouTube dependencies."""
import json
from urllib.request import Request, urlopen
from urllib.parse import urlencode, urljoin
from urllib.parse import urlparse
from PyEngine.core.security import validate_url


def is_tiktok_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        host = (parsed.hostname or '').lower().rstrip('.')
        return parsed.scheme in ('http', 'https') and (host == 'tiktok.com' or host.endswith('.tiktok.com'))
    except ValueError:
        return False


TIKTOK_FORMATS = [
    {'label': 'Download', 'value': 'tiktok', 'desc': 'Standard video', 'qualities': []},
    {'label': 'No Watermark Download', 'value': 'tiktok_no_watermark',
     'desc': 'Video without the TikTok watermark', 'qualities': []},
]


BASE_URL = 'https://www.tikwm.com'
HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': BASE_URL + '/'}


def resolve_video(url: str) -> dict:
    validate_url(url)
    if not is_tiktok_url(url):
        raise ValueError('The TikTok engine requires a TikTok link.')
    request = Request(BASE_URL + '/api/',
                      data=urlencode({'url': url, 'hd': '1'}).encode(),
                      headers={**HEADERS, 'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Response is too large')
        result = json.loads(raw)
    except Exception as exc:
        raise RuntimeError('TikTok service could not be reached or returned an invalid response. Please retry.') from exc
    if not isinstance(result, dict) or result.get('code') != 0:
        detail = str(result.get('msg', 'Video unavailable'))[:250] if isinstance(result, dict) else 'Invalid response'
        raise RuntimeError(f'TikTok service: {detail}')
    data = result.get('data')
    if not isinstance(data, dict) or not any(data.get(key) for key in ('play', 'hdplay', 'wmplay')):
        raise RuntimeError('No video found. Paste a public TikTok video link, not a profile or photo post.')
    return data


def media_url(data: dict, mode: str, prefer_hd: bool = True) -> str:
    if mode == 'tiktok':
        value = data.get('wmplay')
        label = 'standard'
    elif mode == 'tiktok_no_watermark':
        value = (data.get('hdplay') or data.get('play')) if prefer_hd else (data.get('play') or data.get('hdplay'))
        label = 'no-watermark'
    else:
        raise ValueError('Unsupported TikTok download option.')
    if not isinstance(value, str) or not value:
        raise RuntimeError(f'The {label} version is unavailable for this video. Try the other download option.')
    return validate_url(urljoin(BASE_URL, value))


def detect_video(url: str) -> dict:
    data = resolve_video(url)
    duration = max(0, int(data.get('duration') or 0))
    minutes, seconds = divmod(duration, 60)
    formats = []
    for option in TIKTOK_FORMATS:
        mode = option['value']
        try:
            media_url(data, mode)
            available = True
        except (ValueError, RuntimeError):
            available = False
        size_key = 'wm_size' if mode == 'tiktok' else ('hd_size' if data.get('hdplay') else 'size')
        size = data.get(size_key)
        formats.append({**option, 'available': available,
                        'filesize': size if isinstance(size, int) and size > 0 else None})
    return {
        'ok': True, 'title': str(data.get('title') or 'TikTok video'),
        'duration': f'{minutes}:{seconds:02d}' if duration else '',
        'thumbnail': str(data.get('cover') or ''), 'webpage_url': url,
        'is_live': False, 'formats': formats, 'format_type': 'video',
    }
