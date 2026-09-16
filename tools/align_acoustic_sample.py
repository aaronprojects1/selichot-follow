"""Align a real-room recording to a known reference for reviewed cue transfer.

This is a development-only diagnostic. It emits timestamps; it never copies
audio into the app build.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("reference_builder", ROOT / "tools" / "build_chant_references.py")
builder = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(builder)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("sample")
    parser.add_argument("--reference", default="supplied-m4a-bizochri")
    args = parser.parse_args()
    source = next(item for item in builder.REFERENCES if item["id"] == args.reference)
    reference = builder.feature_frames(builder.decode_audio(source["path"], source["channel"]))[:, :12]
    sample = builder.feature_frames(builder.decode_audio(Path(args.sample), "mono"))[:, :12]

    # Try pitch offsets and retain the best global chroma alignment.
    best_cost = None
    best_shift = 0
    best_distances = None
    for shift in range(12):
        shifted = np.roll(reference, shift, axis=1)
        distances = 1 - np.clip(sample @ shifted.T, -1, 1)
        rough = float(np.mean(np.min(distances, axis=1)))
        if best_cost is None or rough < best_cost:
            best_cost, best_shift, best_distances = rough, shift, distances

    rows, cols = best_distances.shape
    accumulated = np.full((rows + 1, cols + 1), np.inf)
    accumulated[0, 0] = 0
    for row in range(1, rows + 1):
        for col in range(1, cols + 1):
            accumulated[row, col] = best_distances[row - 1, col - 1] + min(
                accumulated[row - 1, col], accumulated[row, col - 1], accumulated[row - 1, col - 1]
            )

    row, col = rows, cols
    path: list[tuple[int, int]] = []
    while row and col:
        path.append((row - 1, col - 1))
        options = (accumulated[row - 1, col - 1], accumulated[row - 1, col], accumulated[row, col - 1])
        step = int(np.argmin(options))
        row, col = ((row - 1, col - 1), (row - 1, col), (row, col - 1))[step]
    path.reverse()

    by_reference: dict[int, list[int]] = {}
    for sample_frame, reference_frame in path:
        by_reference.setdefault(reference_frame, []).append(sample_frame)
    print(f"pitch_shift={best_shift} normalized_dtw={accumulated[-1, -1] / len(path):.4f}")
    for seconds, anchor in source["cues"]:
        reference_frame = round(seconds * 1000 / builder.HOP_MS)
        candidates = by_reference.get(reference_frame) or by_reference.get(max(0, reference_frame - 1)) or []
        if candidates:
            print(f"{seconds:5.2f}s -> {np.median(candidates) * builder.HOP_MS / 1000:5.2f}s  {anchor}")


if __name__ == "__main__":
    main()
