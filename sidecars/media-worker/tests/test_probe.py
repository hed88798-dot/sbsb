from __future__ import annotations

import unittest

from media_worker.contracts import WorkerError
from media_worker.pipeline import parse_probe_document


class ProbeTests(unittest.TestCase):
    def test_parses_vfr_rotation_4k_and_ignores_audio_layout(self) -> None:
        parsed = parse_probe_document(
            {
                "streams": [
                    {
                        "codec_type": "video",
                        "width": 2160,
                        "height": 3840,
                        "duration": "12.345",
                        "avg_frame_rate": "30000/1001",
                        "r_frame_rate": "60/1",
                        "side_data_list": [{"rotation": -90}],
                    },
                    {"codec_type": "audio", "index": 1},
                    {"codec_type": "audio", "index": 2},
                ],
                "format": {"duration": "12.400"},
            }
        )
        self.assertEqual(parsed["duration_ms"], 12345)
        self.assertEqual(parsed["rotation"], -90)
        self.assertAlmostEqual(parsed["fps"], 29.97002997)
        self.assertEqual((parsed["width"], parsed["height"]), (2160, 3840))

    def test_rejects_missing_video_and_unsafe_dimensions(self) -> None:
        with self.assertRaises(WorkerError):
            parse_probe_document({"streams": [{"codec_type": "audio"}], "format": {}})
        with self.assertRaises(WorkerError):
            parse_probe_document(
                {
                    "streams": [
                        {
                            "codec_type": "video",
                            "width": 10000,
                            "height": 10000,
                            "duration": "1",
                            "avg_frame_rate": "25/1",
                        }
                    ]
                }
            )


if __name__ == "__main__":
    unittest.main()
