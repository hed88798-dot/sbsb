from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

from media_worker.contracts import WorkerError
from media_worker.pipeline import index_asset, probe_media


class MediaSecurityTests(unittest.TestCase):
    def test_rejects_symlink_input_before_media_tools_run(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "真实 素材.mp4"
            source.write_bytes(b"synthetic")
            link = root / "linked.mp4"
            link.symlink_to(source)
            with self.assertRaisesRegex(WorkerError, "non-symlink"):
                index_asset(
                    {"input_path": str(link), "output_dir": str(root / "output")},
                    lambda _stage, _progress, _details: None,
                )

    def test_corrupted_media_is_a_single_file_probe_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "零字节 视频.mp4"
            source.write_bytes(b"")
            with self.assertRaises(WorkerError) as failure:
                probe_media(source, Path(sys.executable))
            self.assertEqual(failure.exception.code, "MEDIA_PROBE_FAILED")
            self.assertFalse(failure.exception.retryable)


if __name__ == "__main__":
    unittest.main()
