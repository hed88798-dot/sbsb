from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from media_worker.pipeline import detect_shots, frame_quality

try:
    import cv2
    import scenedetect  # noqa: F401
except ImportError:
    cv2 = None


@unittest.skipIf(cv2 is None, "full media fixture dependencies are not installed")
class ShotDetectionTests(unittest.TestCase):
    parameters = {
        "adaptive_threshold": 3.0,
        "min_scene_len_frames": 10,
        "window_width": 2,
        "luma_only": False,
    }

    def write_video(self, path: Path, frames: list[np.ndarray], fps: int = 20) -> None:
        writer = cv2.VideoWriter(
            str(path), cv2.VideoWriter_fourcc(*"MJPG"), fps, (frames[0].shape[1], frames[0].shape[0])
        )
        self.assertTrue(writer.isOpened())
        try:
            for frame in frames:
                writer.write(frame)
        finally:
            writer.release()

    def scenes(self, frames: list[np.ndarray]) -> list[tuple[int, int]]:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "合成 fixture.avi"
            self.write_video(path, frames)
            duration_ms = round(len(frames) / 20 * 1000)
            return detect_shots(path, self.parameters, duration_ms)

    @staticmethod
    def solid(bgr: tuple[int, int, int], count: int) -> list[np.ndarray]:
        return [np.full((48, 64, 3), bgr, dtype=np.uint8) for _ in range(count)]

    def test_hard_cut_produces_precise_shot_ranges(self) -> None:
        scenes = self.scenes(self.solid((0, 0, 255), 30) + self.solid((255, 0, 0), 30))
        self.assertEqual(len(scenes), 2)
        self.assertEqual(scenes[0][0], 0)
        self.assertEqual(scenes[-1][1], 3000)

    def test_long_static_and_continuous_similar_frames_stay_single(self) -> None:
        frames = self.solid((120, 120, 120), 60)
        for index, frame in enumerate(frames):
            frame[:, :, :] = 120 + (index % 3)
        self.assertEqual(len(self.scenes(frames)), 1)

    def test_fast_motion_and_shake_do_not_fragment_every_frame(self) -> None:
        base = np.indices((48, 64)).sum(axis=0) % 2 * 255
        frames = []
        for index in range(60):
            shifted = np.roll(base, shift=index % 8, axis=1).astype(np.uint8)
            frames.append(np.stack((shifted, shifted, shifted), axis=-1))
        self.assertLessEqual(len(self.scenes(frames)), 3)

    def test_fade_and_extremely_short_middle_segment_remain_bounded(self) -> None:
        fade = [np.full((48, 64, 3), value, dtype=np.uint8) for value in range(0, 256, 8)]
        short_middle = self.solid((0, 0, 0), 25) + self.solid((255, 255, 255), 4) + self.solid((0, 0, 0), 25)
        self.assertLessEqual(len(self.scenes(fade)), 2)
        self.assertLessEqual(len(self.scenes(short_middle)), 2)

    def test_quality_flags_dark_overexposed_and_blurred_frames(self) -> None:
        black = np.zeros((48, 64, 3), dtype=np.uint8)
        white = np.full((48, 64, 3), 255, dtype=np.uint8)
        checker = np.indices((48, 64)).sum(axis=0) % 2 * 255
        sharp = np.stack((checker, checker, checker), axis=-1).astype(np.uint8)
        blurred = cv2.GaussianBlur(sharp, (15, 15), 0)
        self.assertGreater(frame_quality(black)["dark"], 0.9)
        self.assertGreater(frame_quality(white)["overexposed"], 0.9)
        self.assertGreater(frame_quality(blurred)["blur"], frame_quality(sharp)["blur"])


if __name__ == "__main__":
    unittest.main()
