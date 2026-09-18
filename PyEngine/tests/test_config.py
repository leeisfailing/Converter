"""Binary lookup must work without a source checkout or system tools."""
import importlib.util
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PyEngine.core import config


class BundledConfigTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        self.engine = self.root / "PyEngine"
        module_path = self.engine / "core" / "config.py"
        module_path.parent.mkdir(parents=True)
        shutil.copyfile(config.__file__, module_path)
        spec = importlib.util.spec_from_file_location("detached_config", module_path)
        self.config = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.config)
        self.python = self.engine / "bin" / "python" / "python.exe"
        self.python.parent.mkdir(parents=True)
        self.python.touch()
        for mock in (
            patch.object(sys, "executable", str(self.python)),
            patch.object(sys, "platform", "win32"),
            patch.object(sys, "frozen", False, create=True),
            patch.object(self.config.shutil, "which", return_value=None),
        ):
            mock.start()
            self.addCleanup(mock.stop)

    def test_embedded_python_finds_engine_resources_and_plain_binaries(self):
        self.assertEqual(self.config.resource_path("cookies.txt"), self.engine / "cookies.txt")
        for name in ("ffmpeg", "ffprobe", "vspipe"):
            expected = self.engine / "bin" / f"{name}.exe"
            expected.touch()
            # A sidecar beside the app must not supersede PyEngine/bin.
            (self.root / f"{name}.exe").touch()
            self.assertEqual(self.config.find_binary(name), str(expected))
            self.assertEqual(self.config.find_binary(f"{name}.exe"), str(expected))
        self.config.shutil.which.assert_not_called()

    def test_installed_sidecars_use_plain_names(self):
        expected = self.root / "ffmpeg.exe"
        expected.touch()
        (self.root / "ffmpeg-x86_64-pc-windows-msvc.exe").touch()
        self.assertEqual(self.config.find_binary("ffmpeg"), str(expected))

    def test_fresh_checkout_finds_prepared_tauri_sidecars(self):
        for name in ('ffmpeg', 'ffprobe'):
            expected = self.root / 'rust/src-tauri/bin' / f'{name}-x86_64-pc-windows-msvc.exe'
            expected.parent.mkdir(parents=True, exist_ok=True)
            expected.touch()
            self.assertEqual(self.config.find_binary(name), str(expected))
        self.config.shutil.which.assert_not_called()

    def test_deno_is_found_beside_private_python_without_system_path(self):
        expected = self.python.parent / "deno.exe"
        expected.touch()
        self.assertEqual(self.config.find_binary("deno"), str(expected))
        self.config.shutil.which.assert_not_called()

    def test_vspipe_prefers_matching_python_package_over_standalone(self):
        package = self.python.parent / "Lib" / "site-packages" / "vapoursynth"
        package.mkdir(parents=True)
        expected = package / "vspipe.exe"
        expected.touch()
        (self.engine / "bin" / "vspipe.exe").touch()
        (self.root / "vspipe.exe").touch()
        self.assertEqual(self.config.find_binary("vspipe"), str(expected))
        self.assertEqual(self.config.find_binary("vspipe.exe"), str(expected))

    def test_pyinstaller_extraction_root_is_preserved(self):
        extraction = self.root / "_MEI123"
        extraction.mkdir()
        expected = extraction / "ffprobe.exe"
        expected.touch()
        with patch.object(sys, "frozen", True), patch.object(sys, "_MEIPASS", str(extraction), create=True):
            self.assertEqual(self.config.resource_path("cookies.txt"), extraction / "cookies.txt")
            self.assertEqual(self.config.find_binary("ffprobe"), str(expected))

    def test_path_fallback_remains_available(self):
        self.config.shutil.which.return_value = "C:/system/ffmpeg.exe"
        self.assertEqual(self.config.find_binary("ffmpeg"), "C:/system/ffmpeg.exe")
        self.config.shutil.which.assert_called_once_with("ffmpeg")

    def test_non_windows_binaries_have_no_exe_suffix(self):
        expected = self.engine / "bin" / "ffmpeg"
        expected.touch()
        with patch.object(sys, "platform", "linux"):
            self.assertEqual(self.config.find_binary("ffmpeg"), str(expected))


if __name__ == "__main__":
    unittest.main()
