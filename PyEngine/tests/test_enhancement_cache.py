"""AI cache files must never own, move, or delete the user's media."""
import tempfile
import importlib.util
import sys
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
with patch.dict(sys.modules, _stubs):
    from PyEngine.workers import enhancer
EnhancerWorker = enhancer.EnhancerWorker


class EnhancementCacheTests(unittest.TestCase):
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
            self.assertEqual(worker.output_path, str(output))


if __name__ == '__main__':
    unittest.main()
