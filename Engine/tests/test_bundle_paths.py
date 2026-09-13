import ctypes
import os
from pathlib import Path
import tempfile
import unittest

from scripts.verify_bundled_runtime import assert_installed_tool


class InstalledToolPathTests(unittest.TestCase):
    def test_resolves_paths_and_rejects_real_escapes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'Converter installed'
            root.mkdir()
            tool = root / 'ffmpeg.exe'
            tool.touch()
            assert_installed_tool(str(tool), root)
            outside = Path(folder) / 'ffmpeg.exe'
            outside.touch()
            with self.assertRaises(AssertionError):
                assert_installed_tool(str(root / '..' / 'ffmpeg.exe'), root)
            with self.assertRaises(AssertionError):
                assert_installed_tool('ffmpeg.exe', root)
            with self.assertRaises(FileNotFoundError):
                assert_installed_tool(str(root / 'missing.exe'), root)

    @unittest.skipUnless(os.name == 'nt', 'Windows short path aliases')
    def test_windows_short_and_long_install_paths_are_equivalent(self):
        with tempfile.TemporaryDirectory(prefix='Converter installed ') as folder:
            root = Path(folder).resolve()
            tool = root / 'ffmpeg.exe'
            tool.touch()
            buffer = ctypes.create_unicode_buffer(32768)
            length = ctypes.windll.kernel32.GetShortPathNameW(str(root), buffer, len(buffer))
            self.assertGreater(length, 0)
            short_root = Path(buffer.value)
            assert_installed_tool(str(tool), short_root)
            assert_installed_tool(str(short_root / 'ffmpeg.exe'), root)


if __name__ == '__main__':
    unittest.main()
