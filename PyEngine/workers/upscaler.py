"""Video/image upscaling using ffmpeg with GPU-first pipeline."""
from pathlib import Path
from PyEngine.core.config import find_binary
from PyEngine.core.security import validate_path, validate_output_path

from PyEngine.workers.ffmpeg import FfmpegWorker
from PyEngine.core.media import probe_media, uses_cuda_frames, decode_args, scale_filter

UPSCALE_PRESETS = {
    "2k": {"width": 2560, "height": 1440, "label": "2K (1440p)"},
    "4k": {"width": 3840, "height": 2160, "label": "4K (2160p)"},
    "8k": {"width": 7680, "height": 4320, "label": "8K (4320p)"},
    "16k": {"width": 15360, "height": 8640, "label": "16K (8640p)"},
}


def find_ffmpeg() -> str:
    return find_binary("ffmpeg")


class UpscalerWorker(FfmpegWorker):
    operation = "Upscale"

    def __init__(
        self,
        input_path: str,
        output_path: str,
        target: str,
        file_type: str = "video",
        use_gpu: bool = False,
        preferred_encoder: str = "",
    ):
        self.input_path = validate_path(input_path, "input_path")
        self.output_path = validate_output_path(output_path, "output_path")
        if target not in UPSCALE_PRESETS:
            raise ValueError(f"Invalid upscale target: {target}. Must be one of: {', '.join(UPSCALE_PRESETS)}")
        self.target = target
        self.target_width = UPSCALE_PRESETS[target]["width"]
        self.target_height = UPSCALE_PRESETS[target]["height"]
        self.file_type = file_type
        self.use_gpu = use_gpu
        self.preferred_encoder = preferred_encoder
        self._init_process()

    def _build_command(self) -> list:
        from PyEngine.core.gpu import (
            get_video_encoder,
            video_encoding_args,
        )
        ffmpeg = find_ffmpeg()
        cmd = [ffmpeg, "-nostdin"]

        video_encoder = None
        if self.file_type == "video":
            output_ext = Path(self.output_path).suffix.lstrip(".").lower()
            video_encoder = get_video_encoder(
                self.use_gpu,
                fallback="libx264",
                preferred_encoder=self.preferred_encoder,
                output_format=output_ext,
            )

        metadata = probe_media(self.input_path) if video_encoder and video_encoder.endswith("_nvenc") else {}
        cuda = uses_cuda_frames(video_encoder, metadata)
        cmd += decode_args(cuda)
        cmd += ["-i", self.input_path]
        cmd += ["-map_metadata", "0"]

        if self.file_type == "video":
            encoder = video_encoder
            cmd += ["-vf", scale_filter(self.target_width, self.target_height, cuda=cuda)]
            cmd += video_encoding_args(encoder, quality=20 if cuda else 18)
            cmd += ["-c:a", "aac", "-b:a", "192k"]
        elif self.file_type == "photo":
            cmd += ["-vf", f"scale={self.target_width}:{self.target_height}:flags=lanczos"]
            ext = Path(self.output_path).suffix.lstrip(".").lower()
            if ext in ("jpg", "jpeg"):
                cmd += ["-q:v", "2"]
            elif ext == "webp":
                cmd += ["-quality", "95"]
            elif ext == "png":
                cmd += ["-compression_level", "6"]

        output_ext = Path(self.output_path).suffix.lstrip(".").lower()
        if output_ext in ("mp4", "mov", "m4v"):
            cmd += ["-movflags", "+use_metadata_tags"]
        cmd += ["-y", self.output_path]
        return cmd
