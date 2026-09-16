"""Build compact, non-reversible chant fingerprints for the web follower.

The generated JSON contains normalized chroma and spectral-shape vectors, not
audio.  It is safe to package with the static site and can be regenerated from
permissioned, verse-timestamped reference recordings.
"""

from __future__ import annotations

import base64
import hashlib
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "SelichotFollow" / "web" / "audio-references.json"
SAMPLE_RATE = 48_000
FFT_SIZE = 2_048
HOP_MS = 140
HOP_SIZE = round(SAMPLE_RATE * HOP_MS / 1_000)
CHROMA_BINS = 12
SPECTRAL_BANDS = 18


REFERENCES = [
    {
        "id": "supplied-m4a-bizochri",
        "family": "bizochri",
        "label": "Bizochri piyut",
        "path": ROOT / "audio slechot.m4a",
        "channel": "left",
        "cues": [
            (0.0, "בזכרי על משכבי זדון לבי ואשמיו"),
            (6.0, "ואמר בנשאי עין בתחנוני אלי שמיו"),
            (12.1, "נפלה נא ביד יהוה כי רבים רחמיו"),
            (18.6, "לך אלי צור חילי מנוסתי בצרתי"),
            (25.0, "בך שברי ותקותי אילותי בגלותי"),
            (31.6, "לך כל משאלות לבי ונגדך כל תאותי"),
            (37.9, "פדה עבד לך צועק מיד רודיו וקמיו"),
            (43.7, "ענני יהוה ענני בקראי מן המצר"),
        ],
    },
    {
        "id": "supplied-opus-adon-haselichot",
        "family": "adon-haselichot",
        "label": "Adon HaSelichot",
        "path": ROOT / "PTT-20260827-WA0000.opus",
        "channel": "mono",
        "cues": [
            (0.0, "שומע תפילות"),
            (1.2, "תמים דעות"),
            (4.3, "חטאנו לפניך רחם עלינו"),
            (10.3, "אל רחום שמך"),
            (13.9, "אל חנון שמך"),
            (17.0, "אל ארך אפים שמך"),
            (19.9, "מלא רחמים שמך"),
            (22.9, "בנו נקרא שמך"),
            (25.4, "יהוה עשה למען שמך"),
        ],
    },
    {
        "id": "nli-ades-adon-haselichot-1982",
        "family": "adon-haselichot",
        "label": "Adon HaSelichot · Jerusalem congregation",
        "path": ROOT / "corpus" / "nli-adon-haselihot-ades-1982.ogg",
        "channel": "mono",
        "sourceUrl": "https://commons.wikimedia.org/wiki/File:The_National_Library_of_Israel_-_Adon_HaSelihot_-_1765167_adon.ogg",
        "license": "CC BY-SA 3.0",
        "attribution": "Congregation of Ades Synagogue; recorded by Chana England; National Library of Israel, 1982",
        "cues": [
            (0.0, "אדון הסליחות"),
            (4.22, "בוחן לבבות"),
            (8.26, "גולה עמוקות"),
            (12.28, "דובר צדקות"),
            (16.18, "חטאנו לפניך רחם עלינו"),
            (23.72, "הדור בנפלאות"),
            (27.94, "ותיק בנחמות"),
            (31.62, "זוכר ברית אבות"),
            (35.04, "חוקר כליות"),
            (38.92, "חטאנו לפניך רחם עלינו"),
            (46.50, "טוב ומטיב לבריות"),
            (50.62, "יודע כל נסתרות"),
            (54.22, "כובש עוונות"),
            (57.98, "לובש צדקות"),
            (61.84, "חטאנו לפניך רחם עלינו"),
            (69.20, "מלא זכויות"),
            (73.48, "נורא תהילות"),
            (77.38, "סולח עוונות"),
            (80.64, "עונה בעת צרות"),
            (84.80, "חטאנו לפניך רחם עלינו"),
        ],
    },
]

# User-provided recording of the supplied Bizochri audio played from one phone
# and captured by a second phone. It contributes only a compact fingerprint to
# the web build; the recording itself remains in the local development folder.
PHONE_TO_PHONE_CUE_TIMES = [0.00, 7.42, 13.16, 19.88, 26.32, 32.90, 39.20, 45.08]
REFERENCES.insert(1, {
    "id": "supplied-m4a-bizochri-phone-to-phone",
    "family": "bizochri",
    "label": "Bizochri piyut · phone-to-phone room capture",
    "path": ROOT / "WhatsApp Ptt 2026-09-06 at 13.04.09.ogg",
    "channel": "mono",
    "cues": [
        (seconds, REFERENCES[0]["cues"][index][1])
        for index, seconds in enumerate(PHONE_TO_PHONE_CUE_TIMES)
    ],
})


def decode_audio(path: Path, channel: str) -> np.ndarray:
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-v", "error",
        "-i", str(path),
        "-vn",
    ]
    if channel == "left":
        command.extend(["-af", "pan=mono|c0=c0"])
    command.extend([
        "-ac", "1",
        "-ar", str(SAMPLE_RATE),
        "-f", "f32le",
        "-",
    ])
    completed = subprocess.run(command, check=True, stdout=subprocess.PIPE)
    return np.frombuffer(completed.stdout, dtype="<f4").astype(np.float64)


def feature_frames(samples: np.ndarray) -> np.ndarray:
    window = np.hanning(FFT_SIZE)
    frequencies = np.fft.rfftfreq(FFT_SIZE, 1 / SAMPLE_RATE)
    chroma_mask = (frequencies >= 80) & (frequencies <= 1_200)
    chroma_frequencies = frequencies[chroma_mask]
    chroma_indices = np.mod(np.rint(12 * np.log2(chroma_frequencies / 440)).astype(int), 12)
    band_edges = np.geomspace(100, 5_000, SPECTRAL_BANDS + 1)
    output = []

    for start in range(0, len(samples), HOP_SIZE):
        frame = samples[start:start + FFT_SIZE]
        if len(frame) < FFT_SIZE:
            frame = np.pad(frame, (0, FFT_SIZE - len(frame)))
        power = np.abs(np.fft.rfft(frame * window)) ** 2

        chroma = np.bincount(
            chroma_indices,
            weights=power[chroma_mask],
            minlength=CHROMA_BINS,
        ).astype(np.float64)
        chroma /= max(1e-12, np.linalg.norm(chroma))

        bands = np.empty(SPECTRAL_BANDS, dtype=np.float64)
        for index in range(SPECTRAL_BANDS):
            mask = (frequencies >= band_edges[index]) & (frequencies < band_edges[index + 1])
            bands[index] = np.log(max(1e-12, np.sum(power[mask])))
        bands -= np.mean(bands)
        bands /= max(1e-12, np.linalg.norm(bands))

        output.append(np.concatenate([chroma, bands]))

    return np.asarray(output)


def encode_features(features: np.ndarray) -> str:
    chroma = np.clip(np.rint(features[:, :CHROMA_BINS] * 255), 0, 255)
    bands = np.clip(np.rint((features[:, CHROMA_BINS:] + 1) * 127.5), 0, 255)
    packed = np.concatenate([chroma, bands], axis=1).astype(np.uint8)
    return base64.b64encode(packed.tobytes()).decode("ascii")


def build_reference(spec: dict) -> dict:
    samples = decode_audio(spec["path"], spec["channel"])
    features = feature_frames(samples)
    source_hash = hashlib.sha256(spec["path"].read_bytes()).hexdigest()
    reference = {
        "id": spec["id"],
        "family": spec.get("family", spec["id"]),
        "label": spec["label"],
        "sourceSha256": source_hash,
        "durationMs": round(len(samples) * 1_000 / SAMPLE_RATE),
        "frames": len(features),
        "features": encode_features(features),
        "cues": [
            {"frame": round(seconds * 1_000 / HOP_MS), "anchor": anchor}
            for seconds, anchor in spec["cues"]
        ],
    }
    for key in ("sourceUrl", "license", "attribution"):
        if spec.get(key):
            reference[key] = spec[key]
    return reference


def main() -> None:
    payload = {
        "version": 1,
        "sampleRate": SAMPLE_RATE,
        "hopMs": HOP_MS,
        "chromaBins": CHROMA_BINS,
        "spectralBands": SPECTRAL_BANDS,
        "references": [build_reference(spec) for spec in REFERENCES],
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
