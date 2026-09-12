"""Windows filesystem paths must survive validation without weakening commands."""
import tempfile
import unittest
from pathlib import Path

from Engine.core import security


class SecurityPathTests(unittest.TestCase):
    def test_file_and_output_paths_accept_native_separators(self):
        with tempfile.TemporaryDirectory(prefix="converter path ") as folder:
            directory = Path(folder).resolve()
            source = directory / "input.txt"
            source.write_text("test", encoding="utf-8")
            self.assertEqual(security.validate_file_exists(str(source)), str(source))
            self.assertEqual(security.validate_cookies_file(str(source)), str(source))
            self.assertEqual(security.validate_output_dir(str(directory)), str(directory))
            output = directory / "output.mp4"
            self.assertEqual(security.validate_output_path(str(output)), str(output))

    def test_path_validation_preserves_rejections(self):
        for value in ("input\x00.mp4", "../input.mp4", "..\\input.mp4", "", "x" * 2049):
            with self.subTest(value=value[:40]), self.assertRaises(ValueError):
                security.validate_path(value)
        for character in ";&|`$":
            for validator in (security.validate_path, security.validate_output_dir):
                with self.subTest(character=character, validator=validator.__name__), self.assertRaisesRegex(ValueError, "dangerous characters"):
                    validator(f"input{character}test")

    def test_non_path_validation_keeps_backslash_restriction(self):
        with self.assertRaisesRegex(ValueError, "dangerous characters"):
            security.sanitize_ffmpeg_args(r"-i input\file")
        with self.assertRaisesRegex(ValueError, "dangerous characters"):
            security.validate_url(r"https://example.com/video\name")


if __name__ == "__main__":
    unittest.main()
