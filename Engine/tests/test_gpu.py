import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from Engine.core import gpu
from Engine.workers.converter import ConverterWorker
from Engine.workers.reducer import ReducerWorker


class GpuTests(unittest.TestCase):
    def tearDown(self):
        gpu.detect_gpu.cache_clear()

    def test_compiled_but_unusable_encoder_is_skipped(self):
        gpu.detect_gpu.cache_clear()
        with patch.object(gpu, "_probe_ffmpeg_encoders", return_value={"h264_nvenc", "h264_qsv"}), patch.object(gpu, "_get_system_gpu_names", return_value=[]), patch.object(gpu, "_encoder_works", side_effect=lambda enc: enc == "h264_qsv") as probe:
            self.assertEqual(gpu.detect_gpu()["encoder"], "h264_qsv")
            self.assertEqual(probe.call_count, 2)

    def test_no_working_hardware_falls_back(self):
        gpu.detect_gpu.cache_clear()
        with patch.object(gpu, "_probe_ffmpeg_encoders", return_value={"h264_nvenc"}), patch.object(gpu, "_get_system_gpu_names", return_value=[]), patch.object(gpu, "_encoder_works", return_value=False):
            self.assertFalse(gpu.detect_gpu()["available"])

    def test_manual_only_encoders_remain_available_without_auto_h264(self):
        gpu.detect_gpu.cache_clear()
        with patch.object(gpu, "_probe_ffmpeg_encoders", return_value={"hevc_nvenc"}), patch.object(gpu, "_get_system_gpu_names", return_value=[]), patch.object(gpu, "_encoder_works", return_value=True):
            info = gpu.detect_gpu()
            self.assertFalse(info["available"])
            self.assertIn("hevc_nvenc", [encoder["id"] for encoder in info["all_encoders"]])

    def test_manual_selection_respects_mode_availability_and_container(self):
        info = {"available": True, "encoder": "h264_nvenc", "all_encoders": [{"id": "hevc_nvenc"}, {"id": "av1_qsv"}]}
        with patch.object(gpu, "detect_gpu", return_value=info):
            self.assertEqual(gpu.get_video_encoder(True, preferred_encoder="hevc_nvenc", output_format="mp4"), "h264_nvenc")
            self.assertEqual(gpu.get_video_encoder(False, preferred_encoder="hevc_nvenc", output_format="mp4"), "hevc_nvenc")
            self.assertEqual(gpu.get_video_encoder(False, preferred_encoder="hevc_nvenc", output_format="avi"), "libx264")
            self.assertEqual(gpu.get_video_encoder(False, "libvpx-vp9", "av1_qsv", "webm"), "av1_qsv")
            self.assertEqual(gpu.get_video_encoder(False, preferred_encoder="h264_amf", output_format="mp4"), "libx264")

    def test_gpu_never_changes_output_codec_family(self):
        with patch.object(gpu, "detect_gpu", return_value={"available": True, "encoder": "h264_nvenc"}):
            for codec in ["gif", "libvpx-vp9", "wmv2", "mpeg2video"]:
                self.assertEqual(gpu.get_video_encoder(True, codec), codec)
            self.assertEqual(gpu.get_video_encoder(True), "h264_nvenc")
            self.assertEqual(gpu.get_video_encoder(False), "libx264")

    def test_quality_options_match_each_encoder(self):
        for encoder, option in [("h264_nvenc", "-cq"), ("h264_amf", "-qp_p"), ("h264_qsv", "-global_quality"), ("libx264", "-crf")]:
            args = gpu.video_encoding_args(encoder, 26)
            self.assertEqual(args[args.index(option) + 1], "26")
            if encoder != "libx264":
                self.assertNotIn("-crf", args)
        self.assertNotIn("-preset", gpu.video_encoding_args("h264_amf"))

    def test_worker_commands_use_safe_decoding_and_correct_codecs(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(gpu, "detect_gpu", return_value={"available": True, "encoder": "h264_nvenc", "hwaccel": "cuda"}):
            source = Path(folder) / "source.mp4"
            source.touch()
            for fmt, codec in [("webm", "libvpx-vp9"), ("gif", "gif"), ("mp4", "h264_nvenc")]:
                args = ConverterWorker(str(source), str(Path(folder) / ("out." + fmt)), fmt, use_gpu=True)._build_command()
                self.assertEqual(args[args.index("-c:v") + 1], codec)
                if codec != "h264_nvenc":
                    self.assertNotIn("-hwaccel_output_format", args)
            args = ReducerWorker(str(source), str(Path(folder) / "reduced.mp4"), use_gpu=True)._build_command()
            self.assertIn("-cq", args)
            self.assertNotIn("-crf", args)
