"""Exercise frame inference against fixed-size model contracts without downloads."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HAS_RUNTIME = all(importlib.util.find_spec(name) for name in ("cv2", "numpy"))


@unittest.skipUnless(HAS_RUNTIME, "Optional image inference runtime is not installed")
class EnhancementFrameTests(unittest.TestCase):
    def test_dynamic_geometry_reuses_metadata_without_probe_inference(self):
        import numpy as np
        from unittest.mock import Mock
        from PyEngine.workers.enhancer import EnhancerWorker

        session = Mock()
        session.get_inputs.return_value = [
            SimpleNamespace(name="image", shape=[1, 3, "height", "width"])]
        session.run.side_effect = lambda _, inputs: [
            inputs["image"].repeat(2, axis=2).repeat(2, axis=3)]
        worker = EnhancerWorker("in.png", "out.png", model_name="realesrgan-x2plus")
        image = np.full((8, 9, 3), 120, np.uint8)
        with patch.object(worker, "_get_session", return_value=session):
            for _ in range(3):
                output = worker._enhance_image(image)
                self.assertEqual(output.shape, (16, 18, 3))
                self.assertTrue(np.all(output == 120))
        session.get_inputs.assert_called_once()
        self.assertEqual(session.run.call_count, 3)

    def test_video_frames_use_fixed_model_geometry_and_registered_scale(self):
        import cv2
        import numpy as np
        from PyEngine.workers.enhancer import EnhancerWorker

        for scale, input_size in ((2, 64), (4, 128)):
            with self.subTest(scale=scale), tempfile.TemporaryDirectory() as folder:
                source, output = Path(folder) / "frame.png", Path(folder) / "enhanced.png"
                # Bigger than a tile, and different from either fixed input shape.
                cv2.imwrite(str(source), np.full((70, 90, 3), 120, np.uint8))

                class FixedSession:
                    def get_inputs(self):
                        return [SimpleNamespace(name="image", shape=[1, 3, input_size, input_size])]

                    def get_outputs(self):
                        return [SimpleNamespace(shape=[1, 3, input_size * scale, input_size * scale])]

                    def run(self, outputs, inputs):
                        value = inputs["image"]
                        self_test.assertEqual(value.shape, (1, 3, input_size, input_size))
                        return [value.repeat(scale, axis=2).repeat(scale, axis=3)]

                self_test = self
                worker = EnhancerWorker(str(source), str(output), tile_size=64)
                with patch.object(worker, "_get_session", return_value=FixedSession()):
                    worker._process_frame(str(source), str(output))
                enhanced = cv2.imread(str(output))
                self.assertEqual(enhanced.shape, (70 * scale, 90 * scale, 3))
                self.assertTrue(np.all(enhanced == 120))


if __name__ == "__main__":
    unittest.main()
