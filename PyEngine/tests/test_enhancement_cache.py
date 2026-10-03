"""AI cache files must never own, move, or delete the user's media."""
import contextlib
import hashlib
import importlib.util
import io
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from PyEngine.core import model_manager as cache

# Exercise file lifecycle without downloading the optional inference runtime.
_stubs = {}
for _name in ('cv2', 'numpy'):
    if importlib.util.find_spec(_name) is None:
        _stubs[_name] = types.ModuleType(_name)
if 'numpy' in _stubs:
    _stubs['numpy'].ndarray = object
if _stubs:
    with patch.dict(sys.modules, _stubs):
        from PyEngine.workers import enhancer
else:
    from PyEngine.workers import enhancer
EnhancerWorker = enhancer.EnhancerWorker


class _ArrayStub:
    """Minimal ndarray stand-in: slices like an image and records writes."""

    def __init__(self, shape=(0, 0, 3)):
        self.shape = shape
        self.writes = []

    def __getitem__(self, key):
        return _ArrayStub()

    def __setitem__(self, key, value):
        self.writes.append(key)


def _registry_with_digest(digest: str) -> dict:
    """Copy of MODEL_REGISTRY with the x4plus pin replaced by digest."""
    registry = {name: dict(info) for name, info in cache.MODEL_REGISTRY.items()}
    registry["realesrgan-x4plus"]["sha256"] = digest
    return registry


class EnhancementCacheTests(unittest.TestCase):
    def test_concurrent_session_misses_construct_once(self):
        from concurrent.futures import ThreadPoolExecutor
        import threading
        import time

        barrier = threading.Barrier(8)
        session = object()

        def construct(*args, **kwargs):
            time.sleep(0.03)
            return session

        runtime = types.SimpleNamespace(InferenceSession=Mock(side_effect=construct))

        def load():
            barrier.wait()
            return cache.get_session("realesrgan-x4plus")

        with patch.dict(sys.modules, {"onnxruntime": runtime}), patch.object(
                cache, "ensure_model", return_value=Path("model.onnx")), patch.object(
                cache, "_sessions", {}), patch.object(cache, "_session_build_locks", {}):
            with ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: load(), range(8)))
        self.assertTrue(all(value is session for value in results))
        runtime.InferenceSession.assert_called_once()

    def test_session_construction_failure_can_be_retried(self):
        session = object()
        runtime = types.SimpleNamespace(
            InferenceSession=Mock(side_effect=[RuntimeError("failed"), session]))
        with patch.dict(sys.modules, {"onnxruntime": runtime}), patch.object(
                cache, "ensure_model", return_value=Path("model.onnx")), patch.object(
                cache, "_sessions", {}), patch.object(cache, "_session_build_locks", {}):
            with self.assertRaises(RuntimeError):
                cache.get_session("realesrgan-x4plus")
            self.assertIs(cache.get_session("realesrgan-x4plus"), session)

    def test_concurrent_downloads_reuse_completed_file(self):
        from concurrent.futures import ThreadPoolExecutor
        import io
        import threading

        barrier = threading.Barrier(4)
        payload = b"x" * (1024 * 1024 + 1)

        def load():
            barrier.wait()
            return cache.download_model("realesrgan-x4plus")

        with tempfile.TemporaryDirectory() as folder:
            response = io.BytesIO(payload)
            response.headers = {"Content-Length": str(len(payload))}
            with patch.object(cache, "MODEL_REGISTRY",
                              _registry_with_digest(hashlib.sha256(payload).hexdigest())), patch.object(
                    cache, "_MODELS_DIR", Path(folder)), patch.object(
                    cache.urllib.request, "urlopen", return_value=response) as request:
                with ThreadPoolExecutor(max_workers=4) as pool:
                    results = list(pool.map(lambda _: load(), range(4)))
                self.assertEqual(results[0].read_bytes(), payload)
                self.assertTrue(all(value == results[0] for value in results))
                request.assert_called_once()

    def test_failed_index_replace_preserves_previous_index(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            index_path = directory / "_index.json"
            with patch.object(cache, "_RESULT_CACHE_DIR", directory), patch.object(
                    cache, "_RESULT_CACHE_INDEX", index_path):
                cache._save_result_index({"old": {"ts": 1}})
                with patch.object(cache.os, "replace", side_effect=OSError("disk failure")):
                    with self.assertRaises(OSError):
                        cache._save_result_index({"new": {"ts": 2}})
                self.assertEqual(cache._load_result_index(), {"old": {"ts": 1}})
                self.assertEqual(list(directory.iterdir()), [index_path])

    def test_video_submission_is_bounded_and_preserves_numbering(self):
        from concurrent.futures import Future

        class RecordingPool:
            def __init__(self, max_workers):
                self.outstanding = []
                self.high_water = 0
                self.outputs = []

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def submit(self, function, source, output):
                future = Future()
                self.outstanding.append(future)
                self.high_water = max(self.high_water, len(self.outstanding))
                self.outputs.append(Path(output).name)
                return future

        pool = RecordingPool(2)

        def complete_one(pending, **kwargs):
            future = pool.outstanding.pop(0)
            future.set_result(None)
            return {future}, set(pending) - {future}

        with tempfile.TemporaryDirectory() as folder:
            worker = EnhancerWorker("input.mp4", str(Path(folder) / "out.mp4"))

            def reassemble(*args):
                Path(worker.output_path).write_bytes(b"video")

            with patch.object(enhancer, "_MAX_WORKERS", 2), patch.object(
                    enhancer, "ThreadPoolExecutor", return_value=pool), patch.object(
                    enhancer, "wait", side_effect=complete_one), patch.object(
                    worker, "_get_video_info", return_value=(10, 10, 30, 1)), patch.object(
                    worker, "_extract_frames", return_value=[str(i) for i in range(100)]), patch.object(
                    worker, "_get_session"), patch.object(
                    worker, "_reassemble_video", side_effect=reassemble):
                worker._enhance_video()
            # Submission stays bounded at max_workers * 2 outstanding frames.
            self.assertLessEqual(pool.high_water, 4)
            self.assertGreaterEqual(pool.high_water, 1)
            self.assertEqual(pool.outputs, [f"enhanced_{i:06d}.png" for i in range(100)])
            self.assertFalse(pool.outstanding)

    def test_dynamic_model_geometry_is_cached_without_inference(self):
        runtime = Mock()
        runtime.get_inputs.return_value = [
            types.SimpleNamespace(name="image", shape=[1, 3, "height", "width"])]
        worker = EnhancerWorker("input.png", "output.png", model_name="realesrgan-x2plus")
        # A non-degenerate frame makes the tiling loop run, so a wrong scale
        # or a wrongly fixed input size cannot pass unnoticed.
        image = _ArrayStub((8, 9, 3))
        output = _ArrayStub((16, 18, 3))
        array_module = types.SimpleNamespace(zeros=Mock(return_value=output), uint8=object())
        tiles = []

        def record_tile(*args):
            tiles.append(args)
            return _ArrayStub()

        with patch.object(enhancer, "np", array_module), patch.object(
                worker, "_get_session", return_value=runtime), patch.object(
                worker, "_infer_tile", side_effect=record_tile):
            for _ in range(3):
                worker._enhance_image(image)
        # Symbolic dimensions resolve once and are reused across calls.
        runtime.get_inputs.assert_called_once()
        runtime.get_outputs.assert_not_called()
        self.assertEqual(array_module.zeros.call_args.args[0], (16, 18, 3))
        self.assertEqual(len(tiles), 3)  # one tile per call, scale reused
        self.assertEqual(tiles[0][3], 2)  # scale falls back to the registry
        self.assertEqual(tiles[0][4:], (0, 0))  # no forced resize of tiles
        self.assertEqual(len(output.writes), 3)  # one tile written per call

    def test_geometry_probe_failures_fall_back_to_registered_scale(self):
        # None shapes (onnxruntime) and raising metadata APIs must not abort
        # the job with an opaque error.
        for label, shape in (("missing shape", None),
                             ("fixed input with failing outputs", [1, 3, 128, 128])):
            with self.subTest(label):
                runtime = Mock()
                runtime.get_inputs.return_value = [
                    types.SimpleNamespace(name="image", shape=shape)]
                runtime.get_outputs.side_effect = RuntimeError("runtime refused")
                worker = EnhancerWorker("input.png", "output.png",
                                        model_name="realesrgan-x2plus")
                output = _ArrayStub((16, 18, 3))
                array_module = types.SimpleNamespace(
                    zeros=Mock(return_value=output), uint8=object())
                tiles = []

                def record_tile(*args):
                    tiles.append(args)
                    return _ArrayStub()

                with patch.object(enhancer, "np", array_module), patch.object(
                        worker, "_get_session", return_value=runtime), patch.object(
                        worker, "_infer_tile", side_effect=record_tile):
                    worker._enhance_image(_ArrayStub((8, 9, 3)))

                self.assertEqual(array_module.zeros.call_args.args[0], (16, 18, 3))
                self.assertEqual(tiles[0][3], 2)
                self.assertEqual(tiles[0][4:], (0, 0) if shape is None else (128, 128))

    def test_hash_includes_bytes_after_first_chunk(self):
        with tempfile.TemporaryDirectory() as folder:
            first, second = Path(folder) / 'a', Path(folder) / 'b'
            first.write_bytes(b'x' * 65536 + b'a')
            second.write_bytes(b'x' * 65536 + b'b')
            self.assertNotEqual(cache._content_hash(str(first)), cache._content_hash(str(second)))

    def test_clear_and_eviction_preserve_user_outputs_and_legacy_entries(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            cache_dir = directory / 'cache'
            source, output = directory / 'input.png', directory / 'output.png'
            source.write_bytes(b'source')
            output.write_bytes(b'enhanced')
            with patch.object(cache, '_RESULT_CACHE_DIR', cache_dir), patch.object(
                    cache, '_RESULT_CACHE_INDEX', cache_dir / '_index.json'):
                cache.store_result(str(source), str(output), 'model', 256)
                cached = cache.get_cached_result(str(source), 'model', 256, '.png')
                self.assertEqual(Path(cached).read_bytes(), b'enhanced')
                self.assertNotEqual(Path(cached), output)
                self.assertIsNone(cache.get_cached_result(str(source), 'model', 256, '.jpg'))
                legacy = {'legacy': {'path': str(output), 'ts': 0}}
                cache._evict_old_entries(legacy)
                self.assertTrue(output.exists())
                index = cache._load_result_index()
                index['legacy'] = {'path': str(output), 'ts': 0}
                cache._save_result_index(index)
                cache.clear_result_cache()
                self.assertEqual(output.read_bytes(), b'enhanced')
                self.assertFalse(Path(cached).exists())

    def test_cache_hit_copies_output_without_consuming_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source, cached, output = (directory / name for name in ('source.png', 'cache.png', 'out.png'))
            source.write_bytes(b'source')
            cached.write_bytes(b'enhanced')
            worker = EnhancerWorker(str(source), str(output))
            worker.on_finished = Mock()
            with patch.object(enhancer, 'get_cached_result', return_value=str(cached)):
                worker._run()
            self.assertEqual(output.read_bytes(), b'enhanced')
            self.assertEqual(cached.read_bytes(), b'enhanced')
            self.assertTrue(worker.on_finished.call_args.args[0])
            self.assertTrue(worker._completed)

    def test_failed_encoding_preserves_existing_destination(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source, output = directory / 'source.mp4', directory / 'out.mp4'
            source.write_bytes(b'source')
            output.write_bytes(b'previous result')
            worker = EnhancerWorker(str(source), str(output))
            worker.on_finished = Mock()

            def fail_after_writing():
                Path(worker.output_path).write_bytes(b'partial')
                raise RuntimeError('encoder failed')

            with patch.object(enhancer, 'get_cached_result', return_value=None), patch.object(
                    worker, '_perform', side_effect=fail_after_writing):
                worker._run()
            self.assertFalse(worker.on_finished.call_args.args[0])
            self.assertEqual(output.read_bytes(), b'previous result')
            self.assertEqual(worker.output_path, str(output.resolve()))

    def test_completed_job_survives_cache_bookkeeping_failure(self):
        # The output is already on disk when store_result runs; a malformed
        # index must not turn that success into a reported failure.
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source, output = directory / 'source.png', directory / 'out.png'
            source.write_bytes(b'source')
            worker = EnhancerWorker(str(source), str(output))
            worker.on_finished = Mock()

            def perform():
                Path(worker.output_path).write_bytes(b'enhanced')

            with patch.object(enhancer, 'get_cached_result', return_value=None), patch.object(
                    worker, '_perform', side_effect=perform), patch.object(
                    enhancer, 'store_result',
                    side_effect=AttributeError("'NoneType' object has no attribute 'get'")):
                worker._run()
            self.assertTrue(worker.on_finished.call_args.args[0])
            self.assertEqual(output.read_bytes(), b'enhanced')

    def test_cache_entry_vanishing_before_copy_runs_processing(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            source, output = directory / 'source.png', directory / 'out.png'
            source.write_bytes(b'source')
            worker = EnhancerWorker(str(source), str(output))
            worker.on_finished = Mock()

            def perform():
                Path(worker.output_path).write_bytes(b'fresh')

            with patch.object(enhancer, 'get_cached_result',
                              return_value=str(directory / 'gone.png')), patch.object(
                    worker, '_perform', side_effect=perform), patch.object(
                    enhancer, 'store_result') as store:
                worker._run()
            self.assertTrue(worker.on_finished.call_args.args[0])
            self.assertEqual(output.read_bytes(), b'fresh')
            store.assert_called_once()

    def test_malformed_index_entries_are_dropped_instead_of_raised(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            index_path = directory / '_index.json'
            with patch.object(cache, '_RESULT_CACHE_DIR', directory), patch.object(
                    cache, '_RESULT_CACHE_INDEX', index_path):
                index_path.write_text(
                    '{"bad": null, "count": 7, "good": {"ts": 1, "path": "x"}}',
                    encoding='utf-8')
                self.assertEqual(cache._load_result_index(),
                                 {'good': {'ts': 1, 'path': 'x'}})
                entries = {'bad': None, 'good': {'ts': 4_000_000_000, 'path': 'x'}}
                cache._evict_old_entries(entries)
                self.assertEqual(list(entries), ['good'])

    def test_worker_rejects_unsafe_paths_at_construction(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            with self.assertRaises(ValueError):
                EnhancerWorker(str(directory / 'input.png'),
                               str(directory / 'missing' / 'out.png'))
            with self.assertRaises(ValueError):
                EnhancerWorker('../escape.png', str(directory / 'out.png'))
            with self.assertRaises(ValueError):
                EnhancerWorker(str(directory / 'input.png'),
                               str(directory / 'out;evil.png'))
            worker = EnhancerWorker(str(directory / 'input.png'),
                                    str(directory / 'out.png'))
            self.assertEqual(worker.output_path, str((directory / 'out.png').resolve()))

    def test_video_frames_stage_beside_the_output(self):
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            worker = EnhancerWorker(str(directory / 'input.mp4'),
                                    str(directory / 'out.mp4'))
            staged = []

            def extract(tmpdir):
                staged.append(tmpdir)
                raise enhancer.EnhancerError('stop here')

            with patch.object(worker, '_get_video_info', return_value=(10, 10, 30, 1)), patch.object(
                    worker, '_extract_frames', side_effect=extract):
                with self.assertRaises(enhancer.EnhancerError):
                    worker._enhance_video()
            self.assertEqual(len(staged), 1)
            self.assertEqual(Path(staged[0]).parent.resolve(), directory.resolve())
            self.assertFalse(Path(staged[0]).exists())

    def test_cache_roots_are_never_the_shared_temp_directory(self):
        roots = cache._cache_roots()
        self.assertTrue(roots)
        for root in roots:
            self.assertNotEqual(root, Path(tempfile.gettempdir()))
        self.assertEqual(roots[-1],
                         Path(tempfile.gettempdir()) / f'converter_{cache._account_tag()}')

    def test_cache_directory_refuses_symlinks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            planted = root / 'ai_models'
            try:
                planted.symlink_to(root / 'elsewhere')
            except (OSError, NotImplementedError):
                self.skipTest('symlinks unavailable on this platform')
            self.assertFalse(cache._prepare_cache_dir(planted))
            self.assertFalse((root / 'elsewhere').exists())
            owned = root / 'Converter' / 'ai_models'
            self.assertTrue(cache._prepare_cache_dir(owned))
            self.assertTrue(owned.is_dir())
            if os.name != 'nt':
                self.assertEqual(owned.stat().st_mode & 0o777, 0o700)

    def test_download_uses_timeout_and_an_exclusive_temp_file(self):
        payload = b'x' * (1024 * 1024 + 1)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            response = io.BytesIO(payload)
            response.headers = {'Content-Length': str(len(payload))}
            with patch.object(cache, 'MODEL_REGISTRY',
                              _registry_with_digest(hashlib.sha256(payload).hexdigest())), patch.object(
                    cache, '_MODELS_DIR', directory), patch.object(
                    cache.urllib.request, 'urlopen', return_value=response) as request:
                dest = cache.download_model('realesrgan-x4plus')
            self.assertEqual(request.call_args.kwargs.get('timeout'),
                             cache._DOWNLOAD_TIMEOUT_SECS)
            self.assertEqual(dest.read_bytes(), payload)
            # A random exclusive file replaces the predictable "<name>.tmp"
            # that another local account could plant as a symlink.
            self.assertEqual(sorted(p.name for p in directory.iterdir()),
                             ['RealESRGAN_x4plus.onnx'])

    def test_download_rejects_a_payload_that_does_not_match_the_pin(self):
        payload = b'x' * (1024 * 1024 + 1)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            response = io.BytesIO(payload)
            response.headers = {'Content-Length': str(len(payload))}
            with patch.object(cache, 'MODEL_REGISTRY',
                              _registry_with_digest('0' * 64)), patch.object(
                    cache, '_MODELS_DIR', directory), patch.object(
                    cache.urllib.request, 'urlopen', return_value=response):
                with self.assertRaisesRegex(RuntimeError, 'SHA256 mismatch'):
                    cache.download_model('realesrgan-x4plus')
            self.assertEqual(list(directory.iterdir()), [])

    def test_unpinned_digest_warns_and_malformed_pin_fails_closed(self):
        payload = b'x' * (1024 * 1024 + 1)
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            response = io.BytesIO(payload)
            response.headers = {'Content-Length': str(len(payload))}
            with patch.object(cache, 'MODEL_REGISTRY',
                              _registry_with_digest('')), patch.object(
                    cache, '_MODELS_DIR', directory), patch.object(
                    cache.urllib.request, 'urlopen', return_value=response):
                stream = io.StringIO()
                with contextlib.redirect_stderr(stream):
                    cache.download_model('realesrgan-x4plus')
                self.assertIn('no SHA256 digest pinned', stream.getvalue())
                (directory / 'RealESRGAN_x4plus.onnx').unlink()
                cache.MODEL_REGISTRY['realesrgan-x4plus']['sha256'] = 'deadbeef'
                with self.assertRaisesRegex(RuntimeError, 'invalid pinned SHA256'):
                    cache.download_model('realesrgan-x4plus')
            self.assertEqual(list(directory.iterdir()), [])

    def test_registry_digests_are_pinned(self):
        for name, info in cache.MODEL_REGISTRY.items():
            with self.subTest(name):
                digest = info.get('sha256', '')
                self.assertEqual(len(digest), 64)
                self.assertTrue(all(c in '0123456789abcdef' for c in digest))


if __name__ == '__main__':
    unittest.main()
