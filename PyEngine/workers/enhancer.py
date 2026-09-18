"""AI enhancement worker using Real-ESRGAN ONNX models.

Features:
  - Session reuse via model_manager.get_session()
  - Result caching (skip re-processing identical files)
  - Parallel frame processing for video (ThreadPoolExecutor)
  - Atomic output (temp dir + os.replace)
  - Graceful cancellation at every step
"""
import gc
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np

from PyEngine.core.model_manager import (
    ensure_model,
    get_session,
    get_cached_result,
    store_result,
)

# Max parallel frame workers.  4 is a safe default; GPU sessions are
# serialised internally by ONNX Runtime so >1 only helps CPU-bound
# pre/post-processing.
_MAX_WORKERS = min(4, (os.cpu_count() or 4))


class EnhancerError(RuntimeError):
    pass


class EnhancerWorker:
    """Runs Real-ESRGAN enhancement on photos or videos.

    Parameters
    ----------
    input_path : str
        Source file path (validated externally).
    output_path : str
        Destination path (validated externally).
    model_name : str
        ONNX model key from MODEL_REGISTRY.
    tile_size : int
        Tile dimension for tiled inference (256 default).
    use_gpu : bool
        Request CUDAExecutionProvider when available.
    """

    operation = "AI Enhancement"

    PHOTO_EXTS = frozenset({
        ".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".tif",
        ".webp", ".heic", ".heif", ".avif",
    })

    def __init__(
        self,
        input_path: str,
        output_path: str,
        model_name: str = "realesrgan-x4plus",
        tile_size: int = 256,
        use_gpu: bool = False,
        selected_gpu: str = "",
    ):
        self.input_path = input_path
        self.output_path = output_path
        self.model_name = model_name
        self.tile_size = max(64, min(tile_size, 512))
        self.use_gpu = use_gpu
        self.selected_gpu = selected_gpu

        self._is_running = True
        self._completed = False
        self._thread: threading.Thread | None = None
        self._process: subprocess.Popen | None = None
        self.on_progress = None
        self.on_finished = None
        self._last_pct = 0

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self):
        self._completed = False
        self._thread = threading.Thread(target=self._run, daemon=False)
        self._thread.start()

    def stop(self):
        self._is_running = False
        proc = self._process
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
            except OSError:
                pass

    def _check_cancelled(self):
        if not self._is_running:
            raise RuntimeError(f"{self.operation} was cancelled")

    # ------------------------------------------------------------------
    # Inference helpers
    # ------------------------------------------------------------------

    def _get_session(self):
        return get_session(self.model_name, self.use_gpu, self.selected_gpu)

    def _preprocess(self, img: np.ndarray) -> np.ndarray:
        """BGR uint8 -> NCHW float32 [0,1] RGB."""
        if len(img.shape) == 2:
            rgb = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        elif img.shape[2] == 4:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGRA2RGB)
        else:
            rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        blob = rgb.astype(np.float32) / 255.0
        return np.transpose(blob, (2, 0, 1))[np.newaxis, ...]

    def _postprocess(self, output: np.ndarray) -> np.ndarray:
        """NCHW float32 RGB -> BGR uint8."""
        output = np.clip(output, 0, 1)
        output = np.squeeze(output)
        output = np.transpose(output, (1, 2, 0))
        output = (output * 255.0).astype(np.uint8)
        return cv2.cvtColor(output, cv2.COLOR_RGB2BGR)

    def _infer_tile(self, tile: np.ndarray, session, input_name: str, out_scale: int,
                    model_input_h: int = 0, model_input_w: int = 0) -> np.ndarray:
        expected_h = tile.shape[0] * out_scale
        expected_w = tile.shape[1] * out_scale
        if model_input_h > 0 and model_input_w > 0:
            if tile.shape[0] != model_input_h or tile.shape[1] != model_input_w:
                resized = cv2.resize(tile, (model_input_w, model_input_h), interpolation=cv2.INTER_LANCZOS4)
            else:
                resized = tile
            processed = self._preprocess(resized)
        else:
            processed = self._preprocess(tile)
        result = session.run(None, {input_name: processed})[0]
        output = self._postprocess(result)
        if output.shape[0] != expected_h or output.shape[1] != expected_w:
            output = cv2.resize(output, (expected_w, expected_h), interpolation=cv2.INTER_LANCZOS4)
        return output

    @staticmethod
    def _probe_model_input_size(model_path: str, input_name: str) -> tuple[int, int]:
        """Probe the model by trying common sizes to find the actual fixed input dimensions."""
        import onnxruntime as ort
        candidates = [64, 128, 192, 256, 512]
        for size in candidates:
            dummy = np.random.rand(1, 3, size, size).astype(np.float32)
            sess = None
            try:
                sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
                sess.run(None, {input_name: dummy})
                return size, size
            except Exception:
                continue
            finally:
                del dummy
                if sess is not None:
                    del sess
        return 0, 0

    def _enhance_image(self, img: np.ndarray) -> np.ndarray:
        from PyEngine.core.model_manager import get_model_path
        session = self._get_session()
        input_meta = session.get_inputs()[0]
        input_name = input_meta.name
        in_shape = input_meta.shape

        model_input_h = 0
        model_input_w = 0
        out_scale = 4
        try:
            out_shape = session.get_outputs()[0].shape
            if (len(in_shape) >= 4
                    and isinstance(in_shape[2], int) and isinstance(in_shape[3], int)
                    and isinstance(out_shape[2], int) and isinstance(out_shape[3], int)):
                model_input_h = in_shape[2]
                model_input_w = in_shape[3]
                out_scale = out_shape[2] // in_shape[2]
            else:
                model_path = str(get_model_path(self.model_name))
                model_input_h, model_input_w = self._probe_model_input_size(model_path, input_name)
                if model_input_h > 0:
                    dummy = np.random.rand(1, 3, model_input_h, model_input_w).astype(np.float32)
                    result = session.run(None, {input_name: dummy})[0]
                    out_scale = result.shape[2] // model_input_h
                    del dummy, result
                    gc.collect()
        except Exception:
            out_scale = 4

        h, w = img.shape[:2]
        tile = self.tile_size
        pad = tile // 4
        output = np.zeros((h * out_scale, w * out_scale, 3), dtype=np.uint8)

        for y in range(0, h, tile):
            if not self._is_running:
                raise RuntimeError(f"{self.operation} was cancelled")
            y_end = min(y + tile, h)
            for x in range(0, w, tile):
                x_end = min(x + tile, w)

                y_pad_start = max(0, y - pad)
                y_pad_end = min(h, y_end + pad)
                x_pad_start = max(0, x - pad)
                x_pad_end = min(w, x_end + pad)
                tile_img = img[y_pad_start:y_pad_end, x_pad_start:x_pad_end]

                result = self._infer_tile(
                    tile_img, session, input_name, out_scale,
                    model_input_h, model_input_w,
                )

                crop_y = (y - y_pad_start) * out_scale
                crop_x = (x - x_pad_start) * out_scale
                crop_h = (y_end - y) * out_scale
                crop_w = (x_end - x) * out_scale
                cropped = result[crop_y:crop_y + crop_h, crop_x:crop_x + crop_w]

                out_y, out_x = y * out_scale, x * out_scale
                output[out_y:out_y + crop_h, out_x:out_x + crop_w] = cropped

        return output

    # ------------------------------------------------------------------
    # Photo enhancement
    # ------------------------------------------------------------------

    def _enhance_photo(self):
        img = cv2.imread(self.input_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            raise EnhancerError(f"Cannot read image: {self.input_path}")

        self._check_cancelled()
        self._emit_progress(15)

        result = self._enhance_image(img)
        del img
        gc.collect()

        self._check_cancelled()
        self._emit_progress(90)

        os.makedirs(os.path.dirname(self.output_path) or ".", exist_ok=True)
        suffix = Path(self.output_path).suffix or ".png"
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=suffix, dir=os.path.dirname(self.output_path) or ".")
        os.close(tmp_fd)
        try:
            cv2.imwrite(tmp_path, result)
            os.replace(tmp_path, self.output_path)
        except Exception:
            p = Path(tmp_path)
            if p.exists():
                p.unlink(missing_ok=True)
            raise
        finally:
            del result
            gc.collect()

    # ------------------------------------------------------------------
    # Video helpers
    # ------------------------------------------------------------------

    def _find_ffprobe(self) -> str:
        from PyEngine.core.config import find_binary
        return find_binary("ffprobe")

    def _find_ffmpeg(self) -> str:
        from PyEngine.core.config import find_binary
        return find_binary("ffmpeg")

    def _get_video_info(self) -> tuple[int, int, float, float]:
        ffprobe = self._find_ffprobe()
        cmd = [
            ffprobe, "-v", "quiet", "-print_format", "json",
            "-show_streams", "-show_format", self.input_path,
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        if result.returncode != 0:
            raise EnhancerError(f"ffprobe failed: {result.stderr[:500]}")
        info = json.loads(result.stdout)
        video = None
        for s in info.get("streams", []):
            if s.get("codec_type") == "video":
                video = s
                break
        if not video:
            raise EnhancerError("No video stream found")
        width = int(video["width"])
        height = int(video["height"])
        fps_str = video.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = fps_str.split("/", 1)
            fps = float(num) / max(float(den), 1.0)
        else:
            fps = float(fps_str)
        duration = float(info.get("format", {}).get("duration", 0))
        return width, height, fps, duration

    def _extract_frames(self, tmpdir: str) -> list[str]:
        pattern = os.path.join(tmpdir, "frame_%06d.png")
        ffmpeg = self._find_ffmpeg()
        cmd = [ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
               "-i", self.input_path, "-q:v", "1", pattern]
        self._check_cancelled()
        self._process = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        _, stderr = self._process.communicate()
        rc = self._process.returncode
        self._process = None
        if rc != 0:
            raise EnhancerError(f"Frame extraction failed (rc={rc}): {stderr.decode(errors='replace')[:500]}")
        frames = sorted(Path(tmpdir).glob("frame_*.png"))
        return [str(f) for f in frames]

    def _reassemble_video(self, tmpdir: str, enhanced_pattern: str, fps: float, frame_count: int):
        ffmpeg = self._find_ffmpeg()
        cmd = [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-framerate", f"{fps:.4f}",
            "-i", enhanced_pattern,
            "-i", self.input_path,
            "-map", "0:v:0",
            "-map", "1:a?",
            "-c:v", "libx264",
            "-preset", "medium",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-shortest",
            self.output_path,
        ]
        self._check_cancelled()
        self._process = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        _, stderr = self._process.communicate()
        rc = self._process.returncode
        self._process = None
        if rc != 0:
            raise EnhancerError(f"Video reassembly failed (rc={rc}): {stderr.decode(errors='replace')[:500]}")

    def _process_frame(self, frame_path: str, out_path: str, session, input_name: str, out_scale: int):
        if not self._is_running:
            raise RuntimeError(f"{self.operation} was cancelled")
        img = cv2.imread(frame_path, cv2.IMREAD_UNCHANGED)
        if img is None:
            return
        result = self._infer_tile(img, session, input_name, out_scale)
        del img
        cv2.imwrite(out_path, result)
        del result

    def _enhance_video(self):
        width, height, fps, duration = self._get_video_info()
        self._check_cancelled()
        self._emit_progress(5)

        with tempfile.TemporaryDirectory(prefix=".enhance_") as tmpdir:
            frame_paths = self._extract_frames(tmpdir)
            total = len(frame_paths)
            if total == 0:
                raise EnhancerError("No frames extracted from video")
            self._emit_progress(20)

            session = self._get_session()
            input_meta = session.get_inputs()[0]
            input_name = input_meta.name
            try:
                out_shape = session.get_outputs()[0].shape
                in_shape = input_meta.shape
                out_scale = out_shape[2] // in_shape[2] if len(out_shape) >= 4 and len(in_shape) >= 4 else 4
            except Exception:
                out_scale = 4

            enhanced_dir = os.path.join(tmpdir, "enhanced")
            os.makedirs(enhanced_dir, exist_ok=True)

            max_workers = 1 if self.use_gpu else _MAX_WORKERS
            completed = 0

            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = []
                for i, fp in enumerate(frame_paths):
                    out = os.path.join(enhanced_dir, f"enhanced_{i:06d}.png")
                    futures.append(pool.submit(self._process_frame, fp, out, session, input_name, out_scale))
                del frame_paths
                gc.collect()

                for future in as_completed(futures):
                    if not self._is_running:
                        pool.shutdown(wait=False, cancel_futures=True)
                        raise RuntimeError(f"{self.operation} was cancelled")
                    exc = future.exception()
                    if exc is not None:
                        pool.shutdown(wait=False, cancel_futures=True)
                        raise exc
                    completed += 1
                    pct = 20 + int(completed / total * 65)
                    if pct > self._last_pct:
                        self._last_pct = pct
                        self._emit_progress(pct)
                futures.clear()

            self._check_cancelled()
            self._emit_progress(90)

            pattern = os.path.join(enhanced_dir, "enhanced_%06d.png")
            os.makedirs(os.path.dirname(self.output_path) or ".", exist_ok=True)
            tmp_out = self.output_path + ".tmp"
            try:
                self._reassemble_video(tmpdir, pattern, fps, total)
                if os.path.exists(self.output_path):
                    os.replace(self.output_path, tmp_out)
                if not os.path.exists(tmp_out) or os.path.getsize(tmp_out) == 0:
                    raise EnhancerError("Video reassembly produced empty output")
                os.replace(tmp_out, self.output_path)
            except Exception:
                for p in (Path(tmp_out), Path(self.output_path)):
                    if p.exists() and p.stat().st_size == 0:
                        p.unlink(missing_ok=True)
                raise

    # ------------------------------------------------------------------
    # Main entry
    # ------------------------------------------------------------------

    def _perform(self):
        ext = Path(self.input_path).suffix.lower()
        if ext in self.PHOTO_EXTS:
            self._enhance_photo()
        else:
            self._enhance_video()

    def _run(self):
        result = (False, "", "")
        try:
            self._check_cancelled()
            if Path(self.input_path).resolve() == Path(self.output_path).resolve():
                raise ValueError("Output must be different from the original file")

            cached = get_cached_result(
                self.input_path, self.model_name, self.tile_size, Path(self.output_path).suffix
            )
            destination = self.output_path
            os.makedirs(os.path.dirname(destination) or ".", exist_ok=True)
            # Encode and restore cache hits on the destination filesystem.
            # Failures must preserve any existing user output.
            with tempfile.TemporaryDirectory(prefix=".enhance-", dir=Path(destination).parent) as folder:
                candidate = Path(folder) / Path(destination).name
                if cached:
                    shutil.copyfile(cached, candidate)
                else:
                    self.output_path = str(candidate)
                    try:
                        self._perform()
                    finally:
                        self.output_path = destination
                self._check_cancelled()
                if not candidate.is_file() or candidate.stat().st_size == 0:
                    raise EnhancerError("Enhancement produced no output")
                os.replace(candidate, destination)
            if not cached:
                # Cache availability must not turn a completed job into failure.
                try:
                    store_result(
                        self.input_path, self.output_path,
                        self.model_name, self.tile_size,
                    )
                except OSError:
                    pass
            if self.on_progress:
                self.on_progress(100)
            result = (True, "Enhanced (cached)" if cached else "", self.output_path)

        except FileNotFoundError as exc:
            result = (False, f"{self.operation} failed: {exc}", "")
        except Exception as exc:
            message = str(exc) if self._is_running else f"{self.operation} was cancelled"
            result = (False, message, "")
        self._completed = True
        if self.on_finished:
            self.on_finished(*result)

    def _emit_progress(self, pct: int):
        if self.on_progress:
            self.on_progress(min(99, pct))
