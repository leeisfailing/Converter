"""Verify Windows wheel installation without downloading or executing Windows files."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from scripts.bundle_runtime import ai_artifacts, install_wheel


class WindowsRuntimeTests(unittest.TestCase):
    def test_ai_manifest_installs_hash_pinned_dependencies(self) -> None:
        artifacts = ai_artifacts()
        self.assertEqual(len(artifacts), 6)
        for url, digest, destination in artifacts:
            self.assertTrue(url.endswith('.whl'))
            self.assertEqual(len(digest), 64)
            self.assertEqual(destination, 'Lib/site-packages')

    def test_ai_manifest_rejects_wrong_python(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'scripts').mkdir()
            (root / 'scripts/ai-runtime-wheels.json').write_text(json.dumps({
                'python': '3.11', 'platform': 'win_amd64', 'wheels': [],
            }), encoding='utf-8')
            with patch('scripts.bundle_runtime.ROOT', root):
                with self.assertRaisesRegex(ValueError, 'Python 3.12'):
                    ai_artifacts()

    def test_wheel_relocates_library_data_and_deno(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            wheel = root / 'example.whl'
            entries = {
                'cv2/__init__.py': 'opencv',
                'numpy.libs/example.dll': 'native dependency',
                'example.data/purelib/helper.py': 'pure library',
                'example.data/platlib/native.pyd': 'native extension',
                'deno.data/scripts/deno.exe': 'deno executable',
            }
            with zipfile.ZipFile(wheel, 'w') as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)
            staging = root / 'runtime'
            install_wheel(wheel, staging)
            for name, content in {
                'Lib/site-packages/cv2/__init__.py': 'opencv',
                'Lib/site-packages/numpy.libs/example.dll': 'native dependency',
                'Lib/site-packages/helper.py': 'pure library',
                'Lib/site-packages/native.pyd': 'native extension',
                'deno.exe': 'deno executable',
            }.items():
                self.assertEqual((staging / name).read_text(), content)
            self.assertFalse((staging / 'Lib/site-packages/example.data').exists())

    def test_wheel_rejects_paths_outside_private_runtime(self) -> None:
        for name in ('../escape.py', '/escape.py', 'C:/escape.py', 'folder\\escape.py',
                     'example.data/purelib/../../../escape.py'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                wheel = root / 'invalid.whl'
                with zipfile.ZipFile(wheel, 'w') as archive:
                    archive.writestr(name, 'bad')
                with self.assertRaisesRegex(ValueError, 'escapes'):
                    install_wheel(wheel, root / 'runtime')
