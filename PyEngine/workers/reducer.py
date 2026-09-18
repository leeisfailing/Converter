"""File size reduction using ffmpeg."""
from pathlib import Path
from PyEngine.core.config import find_binary
from PyEngine.core.security import validate_path, validate_output_path
from typing import List, Optional

from PyEngine.workers.ffmpeg import FfmpegWorker
from PyEngine.core.media import probe_media, uses_cuda_frames, decode_args, scale_filter


def find_ffmpeg() -> str:
    return find_binary("ffmpeg")


class ReducerWorker(FfmpegWorker):
    operation = "Reduction"

    def __init__(
        self,
        input_path: str,
        output_path: str,
        quality: int = 50,
        file_type: str = "video",
        target_bytes: Optional[int] = None,
        use_gpu: bool = False,
        preferred_encoder: str = "",
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        self.quality = max(1, min(100, quality))
        self.file_type = file_type
        self.target_bytes = target_bytes
        self.use_gpu = use_gpu
        self.preferred_encoder = preferred_encoder
        self._init_process()

    def _build_command(self) -> List[str]:
        from PyEngine.core.gpu import get_video_encoder, video_encoding_args
        ffmpeg = find_ffmpeg()
        cmd = [ffmpeg, "-nostdin"]

        # Determine video encoder early so hwaccel can be encoder-aware
        video_encoder = None
        if self.file_type == "video":
            video_encoder = get_video_encoder(self.use_gpu, fallback="libx264", preferred_encoder=self.preferred_encoder, output_format=Path(self.output_path).suffix.lstrip(".").lower())

        metadata = probe_media(self.input_path) if video_encoder and video_encoder.endswith("_nvenc") else {}
        cuda = uses_cuda_frames(video_encoder, metadata)
        cmd += decode_args(cuda)
        cmd += ["-i", self.input_path]
        cmd += ["-map_metadata", "0"]

        if self.file_type == "video":
            crf = max(1, min(51, int(40 - (self.quality * 0.28))))
            encoder = video_encoder
            cmd += video_encoding_args(encoder, crf)
            cmd += ["-c:a", "aac", "-b:a", "128k"]

        elif self.file_type == "photo":
            ext = Path(self.output_path).suffix.lstrip(".").lower()
            if ext in ("jpg", "jpeg"):
                qv = max(2, min(31, int(31 - (self.quality * 0.29))))
                cmd += ["-q:v", str(qv)]
            elif ext == "webp":
                cmd += ["-quality", str(self.quality)]
            elif ext == "png":
                level = max(0, min(9, int(9 - self.quality / 100 * 9)))
                cmd += ["-compression_level", str(level)]
        elif self.file_type == "audio":
            bitrate = max(32, min(320, int(32 + self.quality * 3.2)))
            cmd += ["-c:a", "libmp3lame", "-b:a", f"{bitrate}k"]

        output_ext = Path(self.output_path).suffix.lstrip(".").lower()
        if output_ext in ("mp4", "mov", "m4v"):
            cmd += ["-movflags", "+use_metadata_tags"]
        cmd += ["-y", self.output_path]
        return cmd

    def _perform(self):
        if self.target_bytes is not None:
            from PyEngine.workers.target_size import reduce_to_target
            reduce_to_target(self)
        else:
            super()._perform()
