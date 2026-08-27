from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args()
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    writer = cv2.VideoWriter(
        str(arguments.output), cv2.VideoWriter_fourcc(*"MJPG"), 10.0, (320, 240)
    )
    if not writer.isOpened():
        raise SystemExit("synthetic fixture video writer is unavailable")
    try:
        for frame_index in range(80):
            if frame_index < 40:
                frame = np.full((240, 320, 3), (80, 150, 220), dtype=np.uint8)
                cv2.ellipse(frame, (160, 135), (95, 55), 0, 0, 360, (115, 175, 235), -1)
                cv2.circle(frame, (235, 115), 32, (125, 185, 240), -1)
                cv2.circle(frame, (247, 105), 4, (20, 20, 20), -1)
                cv2.putText(
                    frame,
                    "HEALTHY PIG",
                    (78, 40),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (25, 25, 25),
                    2,
                    cv2.LINE_AA,
                )
            else:
                frame = np.full((240, 320, 3), (235, 245, 245), dtype=np.uint8)
                cv2.rectangle(frame, (125, 58), (195, 190), (245, 245, 245), -1)
                cv2.rectangle(frame, (139, 35), (181, 63), (40, 70, 170), -1)
                cv2.rectangle(frame, (132, 95), (188, 154), (40, 130, 210), -1)
                cv2.putText(
                    frame,
                    "VET",
                    (140, 130),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (255, 255, 255),
                    2,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "MEDICINE",
                    (85, 220),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (25, 25, 25),
                    2,
                    cv2.LINE_AA,
                )
            writer.write(frame)
    finally:
        writer.release()


if __name__ == "__main__":
    main()
