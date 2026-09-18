"""Encode complete media into a verified byte budget without truncating it."""
import json
import math
import os
import shutil
from pathlib import Path
import subprocess
import sys
import tempfile

from PyEngine.core.config import find_binary
from PyEngine.core.gpu import get_video_encoder, video_encoding_args
from PyEngine.core.media import uses_cuda_frames, decode_args, scale_filter


def _execute(worker, args):
    if not worker._is_running:
        raise RuntimeError('Reduction was cancelled')
    with tempfile.TemporaryFile(mode='w+b') as errors:
        proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=errors,
                                creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        worker._process = proc
        try:
            while True:
                if not worker._is_running:
                    proc.kill()
                    proc.communicate()
                    raise RuntimeError('Reduction was cancelled')
                try:
                    output, _ = proc.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    continue
            if proc.returncode:
                errors.seek(0, 2)
                errors.seek(max(0, errors.tell() - 4000))
                raise RuntimeError(errors.read().decode('utf-8', errors='replace'))
            return output
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            worker._process = None


def reduce_to_target(worker):
    target = worker.target_bytes
    if type(target) is not int or not 0 < target <= 10_000_000_000:
        raise ValueError('Target size must be greater than zero and at most 10 GB')
    destination = Path(worker.output_path)
    if destination.resolve() == Path(worker.input_path).resolve():
        raise ValueError('Output must be different from the original file')
    extension = {'video': '.mp4', 'audio': '.mp3', 'photo': '.webp'}[worker.file_type]
    if destination.suffix.lower() != extension:
        raise ValueError(f'Target-size {worker.file_type} output must use {extension}')
    metadata = json.loads(_execute(worker, [find_binary('ffprobe'), '-v', 'error',
        '-show_streams', '-show_format', '-of', 'json', worker.input_path]))
    streams = metadata.get('streams', [])
    video = next((s for s in streams if s.get('codec_type') == 'video'), None)
    audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
    duration = float(metadata.get('format', {}).get('duration') or 0)
    if worker.file_type != 'photo' and (not math.isfinite(duration) or duration <= 0):
        raise ValueError('Cannot determine media duration for the target size')
    width = int(video['width']) if video else 0
    budget = max(0, target - 1024) * 8 * 0.88 / duration if duration else 0
    with tempfile.TemporaryDirectory(prefix='.reduce-', dir=destination.parent) as folder:
        candidate = Path(folder) / ('result' + extension)
        best = Path(folder) / ('best' + extension)

        def keep_candidate():
            if not worker._is_running:
                raise RuntimeError('Reduction was cancelled')
            if 0 < candidate.stat().st_size <= target:
                os.replace(candidate, best)
                return True
            return False

        def finish():
            if not worker._is_running:
                raise RuntimeError('Reduction was cancelled')
            os.replace(best, destination)
            if worker.on_progress:
                worker.on_progress(100)

        source = Path(worker.input_path)
        if (source.suffix.lower() == extension and source.stat().st_size <= target
                and (not video or width == int(video['width']))):
            shutil.copyfile(source, best)
            finish()
            return

        if worker.file_type == 'photo':
            if not video:
                raise ValueError('No image stream found')
            base = [find_binary('ffmpeg'), '-v', 'error', '-nostdin', '-y', '-i', worker.input_path,
                    '-vf', f'scale={width}:-1', '-c:v', 'libwebp', '-compression_level', '6', '-an']
            # Prefer pixel-preserving compression before any lossy quality search.
            _execute(worker, base + ['-lossless', '1', str(candidate)])
            if keep_candidate():
                finish()
                return
            low, high = 1, 100
            for attempt in range(7):
                if low > high:
                    break
                quality = (low + high) // 2
                _execute(worker, base + ['-quality', str(quality), str(candidate)])
                if keep_candidate():
                    low = quality + 1
                else:
                    high = quality - 1
                if worker.on_progress:
                    worker.on_progress(10 + attempt * 12)
            if best.exists():
                finish()
                return
            raise ValueError('Target is too small at this resolution. Choose a larger size or smaller width.')

        rates = [320, 256, 224, 192, 160, 128, 112, 96, 80, 64, 56, 48, 40, 32, 24, 16, 8]
        rates = [r for r in rates if r * 1000 * duration / 8 <= target]
        if not rates:
            raise ValueError('Target is too small for this audio. Choose a larger size.')
        lower, upper = 0, None
        encoder = None
        cuda = False
        if worker.file_type == 'video':
            encoder = get_video_encoder(worker.use_gpu, preferred_encoder=worker.preferred_encoder, output_format='mp4')
            cuda = uses_cuda_frames(encoder, {'vcodec': video.get('codec_name'), 'pix_fmt': video.get('pix_fmt')}) if video else False
        for attempt in range(len(rates) if worker.file_type == 'audio' else 12):
            cmd = [find_binary('ffmpeg'), '-v', 'error', '-nostdin', '-y', *decode_args(cuda), '-i', worker.input_path,
                   '-map_metadata', '0']
            if worker.file_type == 'audio':
                if not audio:
                    raise ValueError('Target is too small for this audio. Choose a larger size.')
                rate = rates[attempt]
                cmd += ['-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', f'{rate}k', '-compression_level', '0']
            else:
                audio_rate = min(192000, max(16000, int(budget * 0.15))) if audio else 0
                video_rate = int(budget - audio_rate)
                if not video or video_rate < 4000:
                    continue
                video_opts = ['-map', '0:V:0', '-vf', scale_filter(width, cuda=cuda, limit=True)]
                if worker.on_progress:
                    worker.on_progress(min(90, 5 + attempt * 16))
                if encoder == 'libx264':
                    video_opts += ['-c:v', encoder, '-b:v', str(video_rate), '-preset', 'veryslow',
                                   '-pix_fmt', 'yuv420p', '-passlogfile', str(Path(folder) / 'analysis')]
                    _execute(worker, cmd + video_opts + ['-pass', '1', '-an', '-f', 'null', os.devnull])
                    cmd += video_opts + ['-pass', '2']
                else:
                    # Hardware rate control, followed by measured byte-budget
                    # adjustment. NVENC multipass runs on the GPU inside one
                    # encode; there is no CPU/x264 analysis pass.
                    video_opts += video_encoding_args(encoder)
                    video_opts += ['-b:v', str(video_rate), '-maxrate', str(int(video_rate * 1.5)),
                                   '-bufsize', str(video_rate * 2)]
                    if encoder.endswith('_nvenc'):
                        video_opts += ['-rc', 'vbr', '-multipass', 'fullres']
                    elif encoder.endswith('_amf'):
                        video_opts += ['-rc', 'vbr_peak']
                    cmd += video_opts
                cmd += ['-map', '0:a:0?', '-movflags', '+faststart+use_metadata_tags']
                if audio:
                    cmd += ['-c:a', 'aac', '-b:a', str(audio_rate)]
            cmd.append(str(candidate))
            if worker.on_progress:
                worker.on_progress(min(90, 10 + attempt * 16))
            _execute(worker, cmd)
            if not worker._is_running:
                raise RuntimeError('Reduction was cancelled')
            size = candidate.stat().st_size
            if keep_candidate():
                if worker.file_type == 'audio' or size >= target * 0.97:
                    finish()
                    return
                lower = budget
                budget = (budget + upper) / 2 if upper else budget * min(2.0, target / max(1, size))
            else:
                upper = budget
                budget = (lower + budget) / 2 if lower else budget * target / max(1, size) * 0.92
        if best.exists():
            finish()
            return
        # Fallback: try progressively smaller resolutions when bitrate alone can't fit
        if video and worker.file_type == 'video':
            for scale in (0.75, 0.6, 0.5, 0.4, 0.3, 0.2):
                scaled_width = max(256, int(width * scale)) & ~1
                fb_budget = max(0, target - 1024) * 8 * 0.80 / duration if duration else 0
                fl, fu = 0, 0
                for attempt in range(10):
                    audio_rate_fb = min(64000, max(8000, int(fb_budget * 0.10))) if audio else 0
                    video_rate_fb = int(fb_budget - audio_rate_fb)
                    if video_rate_fb < 3000:
                        break
                    cmd = [find_binary('ffmpeg'), '-v', 'error', '-nostdin', '-y', *decode_args(cuda),
                           '-i', worker.input_path, '-map_metadata', '0', '-map', '0:V:0',
                           '-vf', scale_filter(scaled_width, cuda=cuda, limit=True)]
                    if encoder == 'libx264':
                        cmd += ['-c:v', 'libx264', '-b:v', str(video_rate_fb), '-preset', 'ultrafast',
                                '-pix_fmt', 'yuv420p', '-passlogfile', str(Path(folder) / 'fb_analysis')]
                        _execute(worker, cmd + ['-pass', '1', '-an', '-f', 'null', os.devnull])
                        cmd += ['-pass', '2']
                    else:
                        cmd += video_encoding_args(encoder)
                        cmd += ['-b:v', str(video_rate_fb), '-maxrate', str(int(video_rate_fb * 1.1)),
                                '-bufsize', str(video_rate_fb)]
                        if encoder.endswith('_nvenc'):
                            cmd += ['-rc', 'constqp', '-qp', '35']
                        elif encoder.endswith('_amf'):
                            cmd += ['-rc', 'cqp', '-qp_p', '35', '-qp_i', '30']
                    cmd += ['-map', '0:a:0?', '-movflags', '+faststart+use_metadata_tags']
                    if audio:
                        cmd += ['-c:a', 'aac', '-b:a', str(audio_rate_fb)]
                    cmd.append(str(candidate))
                    _execute(worker, cmd)
                    if not worker._is_running:
                        raise RuntimeError('Reduction was cancelled')
                    fb_size = candidate.stat().st_size
                    if keep_candidate():
                        if fb_size >= target * 0.95:
                            finish()
                            return
                        fl = fb_budget
                        fb_budget = (fb_budget + fu) / 2 if fu else fb_budget * min(2.0, target / max(1, fb_size))
                    else:
                        fu = fb_budget
                        fb_budget = (fl + fb_budget) / 2 if fl else fb_budget * target / max(1, fb_size) * 0.85
                if best.exists():
                    finish()
                    return
            # Last resort: try CRF encoding at minimal resolution to get under target
            for scale in (0.5, 0.25):
                scaled_width = max(256, int(width * scale)) & ~1
                for crf in range(51, 27, -3):
                    cmd = [find_binary('ffmpeg'), '-v', 'error', '-nostdin', '-y', *decode_args(cuda),
                           '-i', worker.input_path, '-map_metadata', '0', '-map', '0:V:0',
                           '-vf', scale_filter(scaled_width, cuda=cuda, limit=True)]
                    if encoder == 'libx264':
                        maxrate = max(40000, int(target * 8 / duration / 2))
                        cmd += ['-c:v', 'libx264', '-crf', str(crf), '-maxrate', str(maxrate),
                                '-bufsize', str(maxrate * 2), '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']
                    else:
                        cmd += video_encoding_args(encoder)
                        maxrate = max(40000, int(target * 8 / duration / 2))
                        cmd += ['-rc', 'vbr', '-cq', str(crf), '-maxrate', str(maxrate),
                                '-bufsize', str(maxrate * 2)]
                    cmd += ['-map', '0:a:0?', '-movflags', '+faststart+use_metadata_tags']
                    if audio:
                        cmd += ['-c:a', 'aac', '-b:a', '48000']
                    cmd.append(str(candidate))
                    _execute(worker, cmd)
                    if not worker._is_running:
                        raise RuntimeError('Reduction was cancelled')
                    if keep_candidate():
                        finish()
                        return
        raise ValueError('Could not fit the complete file within the target size. Choose a larger size or smaller width.')
