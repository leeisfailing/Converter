"""File format conversion using ffmpeg."""
from PyEngine.core.config import find_binary
from PyEngine.core.security import validate_path, validate_output_path, validate_string
from typing import List, Optional

from PyEngine.workers.ffmpeg import FfmpegWorker
from PyEngine.core.media import probe_media, uses_cuda_frames, decode_args, scale_filter


def find_ffmpeg() -> str:
    return find_binary("ffmpeg")


class ConverterWorker(FfmpegWorker):
    def __init__(
        self,
        input_path: str,
        output_path: str,
        output_format: str,
        dev_mode: bool = False,
        use_gpu: bool = False,
        preferred_encoder: str = "",
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        self.output_format = validate_string(output_format, "output_format", 32)
        self.dev_mode = dev_mode
        self.use_gpu = use_gpu
        self.preferred_encoder = preferred_encoder
        self.max_width: Optional[int] = None
        self._init_process()

    _CODEC_MAP = {
        'libx264': 'h264', 'h264_nvenc': 'h264', 'h264_amf': 'h264', 'h264_qsv': 'h264',
        'libx265': 'hevc', 'hevc_nvenc': 'hevc', 'hevc_amf': 'hevc', 'hevc_qsv': 'hevc',
        'libvpx-vp9': 'vp9', 'av1_nvenc': 'av1', 'av1_amf': 'av1', 'av1_qsv': 'av1',
    }

    def _codec_for_encoder(self, encoder: str) -> Optional[str]:
        return self._CODEC_MAP.get(encoder)

    def _probe_codecs(self) -> Optional[dict]:
        return probe_media(self.input_path) or None

    def _build_command(self) -> List[str]:
        from PyEngine.formats.video import VIDEO_OUTPUT_FORMATS
        from PyEngine.formats.photo import PHOTO_OUTPUT_FORMATS
        from PyEngine.formats.audio import AUDIO_OUTPUT_FORMATS
        from PyEngine.formats.detection import detect_file_type
        from PyEngine.core.gpu import get_video_encoder, video_encoding_args

        file_type = detect_file_type(self.input_path)
        fmt = self.output_format
        output_args = ['-map_metadata', '0']
        cuda = False
        if fmt in AUDIO_OUTPUT_FORMATS and (file_type in ('video', 'audio') or self.dev_mode):
            options = AUDIO_OUTPUT_FORMATS[fmt]
            output_args += ['-map', '0:a:0', '-vn']
            if options.get('acodec'):
                output_args += ['-c:a', options['acodec']]
            if options.get('bitrate'):
                output_args += ['-b:a', options['bitrate']]
        elif fmt in PHOTO_OUTPUT_FORMATS and (file_type == 'photo' or (self.dev_mode and fmt not in VIDEO_OUTPUT_FORMATS)):
            options = PHOTO_OUTPUT_FORMATS[fmt]
            output_args += ['-frames:v', '1']
            if 'quality' in options:
                output_args += ['-q:v', options['quality']]
            if 'compression' in options:
                output_args += ['-compression_level', options['compression']]
        elif fmt in VIDEO_OUTPUT_FORMATS and (file_type in ('video', 'photo') or self.dev_mode):
            options = VIDEO_OUTPUT_FORMATS[fmt]
            encoder = get_video_encoder(self.use_gpu, fallback=options['vcodec'],
                                        preferred_encoder=self.preferred_encoder, output_format=fmt)
            metadata = (self._probe_codecs() or {}) if file_type == 'video' else {}
            copy_video = (file_type == 'video' and not self.max_width
                          and metadata.get('vcodec') is not None
                          and metadata.get('vcodec') == self._codec_for_encoder(encoder))
            output_args += ['-map', '0:V:0', '-map', '0:a:0?']
            if copy_video:
                output_args += ['-c:v', 'copy']
            else:
                cuda = uses_cuda_frames(encoder, metadata)
                if self.max_width:
                    output_args += ['-vf', scale_filter(self.max_width, cuda=cuda, limit=True)]
                output_args += video_encoding_args(encoder, quality=18)
            audio_encoder = options.get('acodec')
            if audio_encoder:
                audio_codec = {'libopus': 'opus', 'libmp3lame': 'mp3'}.get(audio_encoder, audio_encoder)
                # Copy only the format's chosen audio codec, never an arbitrary
                # codec from a source container with broader codec support.
                if copy_video and metadata.get('acodec') == audio_codec:
                    output_args += ['-c:a', 'copy']
                else:
                    output_args += ['-c:a', audio_encoder, '-b:a', '192k']
            else:
                output_args += ['-an']
        else:
            raise ValueError(f"Unsupported file type '{file_type}' for conversion. Please select a supported output format.")

        if fmt in ('mp4', 'mov', 'm4v'):
            output_args += ['-movflags', '+use_metadata_tags']
        return [find_ffmpeg(), '-y', '-nostdin', '-hide_banner', *decode_args(cuda),
                '-i', self.input_path, *output_args, self.output_path]
