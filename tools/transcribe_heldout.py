"""Sample held-out chant recordings with the locally cached Whisper model.

This is an evaluation helper. It prints approximate timestamps and text and
does not copy source audio into either application artifact.
"""

from __future__ import annotations

import argparse
import json
import sys

from faster_whisper import WhisperModel


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--model", default="small")
    parser.add_argument("--clips", default="0,30")
    parser.add_argument("--language", default="he")
    args = parser.parse_args()

    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=8)
    segments, info = model.transcribe(
        args.audio,
        language=args.language,
        clip_timestamps=args.clips,
        beam_size=3,
        condition_on_previous_text=False,
        hotwords=(
            "אדון הסליחות בן אדם מה לך נרדם אל מלך יושב על כסא רחמים "
            "אל רחום שמך אל חנון שמך חטאנו לפניך רחם עלינו"
        ),
    )
    print(json.dumps({
        "language": info.language,
        "languageProbability": round(info.language_probability, 4),
        "duration": round(info.duration, 3),
    }, ensure_ascii=False), flush=True)
    for segment in segments:
        print(json.dumps({
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text.strip(),
            "avgLogprob": round(segment.avg_logprob, 4),
            "noSpeechProb": round(segment.no_speech_prob, 4),
        }, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
