"""Development-only acoustic diagnostics for Selichot recordings.

The source recording is never copied into the Android project. The metrics are
proxies intended to tune VAD/matching behavior, not laboratory RT60 or SNR.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from scipy.signal import find_peaks


def decode_mono_16k(path: Path) -> np.ndarray:
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-v", "error",
        "-i", str(path),
        "-vn",
        "-ac", "1",
        "-ar", "16000",
        "-f", "f32le",
        "-",
    ]
    completed = subprocess.run(command, check=True, stdout=subprocess.PIPE)
    return np.frombuffer(completed.stdout, dtype="<f4").copy()


def runs(mask: np.ndarray, hop_seconds: float) -> list[float]:
    if mask.size == 0:
        return []
    edges = np.diff(np.pad(mask.astype(np.int8), (1, 1)))
    starts = np.flatnonzero(edges == 1)
    ends = np.flatnonzero(edges == -1)
    return ((ends - starts) * hop_seconds).tolist()


def analyze(samples: np.ndarray, sample_rate: int = 16000) -> dict[str, float | int | str]:
    frame_size = int(sample_rate * 0.020)
    hop_size = int(sample_rate * 0.010)
    if samples.size < frame_size:
        raise ValueError("Recording is too short")
    frame_count = 1 + (samples.size - frame_size) // hop_size
    frames = np.lib.stride_tricks.as_strided(
        samples,
        shape=(frame_count, frame_size),
        strides=(samples.strides[0] * hop_size, samples.strides[0]),
    )
    window = np.hanning(frame_size).astype(np.float32)
    rms = np.sqrt(np.mean((frames * window) ** 2, axis=1) + 1e-12)
    db = 20.0 * np.log10(rms + 1e-9)

    noise_db = float(np.percentile(db, 12))
    speech_db = float(np.percentile(db, 78))
    activity_threshold = noise_db + min(12.0, max(6.0, (speech_db - noise_db) * 0.42))
    active = db > activity_threshold

    # Smooth enough to measure tails rather than individual pitch periods.
    kernel = np.ones(7, dtype=np.float64) / 7.0
    smooth_db = np.convolve(db, kernel, mode="same")
    peaks, _ = find_peaks(smooth_db, distance=35, prominence=5.0)
    t10_values: list[float] = []
    tail_frames = 90
    for peak in peaks:
        if smooth_db[peak] < noise_db + 14.0:
            continue
        tail = smooth_db[peak : min(smooth_db.size, peak + tail_frames)]
        below = np.flatnonzero(tail <= smooth_db[peak] - 10.0)
        if below.size:
            seconds = float(below[0] * 0.010)
            if 0.04 <= seconds <= 0.80:
                t10_values.append(seconds)

    speech_runs = runs(active, 0.010)
    pause_runs = runs(~active, 0.010)
    clipped = float(np.mean(np.abs(samples) >= 0.988) * 100.0)
    peak_dbfs = float(20.0 * np.log10(np.max(np.abs(samples)) + 1e-9))
    overall_dbfs = float(20.0 * np.log10(np.sqrt(np.mean(samples**2)) + 1e-9))
    t10 = float(np.median(t10_values)) if t10_values else 0.0

    # A 40 ms periodicity view is deliberately separate from the speech-like 20 ms VAD.
    # Chant can be strongly pitched even when a speech recognizer rejects it before ASR.
    pitch_size = int(sample_rate * 0.040)
    pitch_hop = int(sample_rate * 0.020)
    pitch_samples = samples if samples.size >= pitch_size else np.pad(samples, (0, pitch_size - samples.size))
    pitch_count = 1 + max(0, (pitch_samples.size - pitch_size) // pitch_hop)
    pitch_frames = np.lib.stride_tricks.as_strided(
        pitch_samples,
        shape=(pitch_count, pitch_size),
        strides=(pitch_samples.strides[0] * pitch_hop, pitch_samples.strides[0]),
    ).copy()
    pitch_frames -= np.mean(pitch_frames, axis=1, keepdims=True)
    pitch_frames *= np.hanning(pitch_size).astype(np.float32)
    fft_size = 1 << int(np.ceil(np.log2(pitch_size * 2 - 1)))
    spectrum = np.fft.rfft(pitch_frames, n=fft_size, axis=1)
    autocorrelation = np.fft.irfft(np.abs(spectrum) ** 2, n=fft_size, axis=1)[:, :pitch_size]
    autocorrelation /= np.maximum(autocorrelation[:, :1], 1e-9)
    minimum_lag = max(1, sample_rate // 420)
    maximum_lag = min(pitch_size - 1, sample_rate // 75)
    lag_slice = autocorrelation[:, minimum_lag : maximum_lag + 1]
    best_offsets = np.argmax(lag_slice, axis=1)
    periodicity = lag_slice[np.arange(pitch_count), best_offsets]
    best_lags = best_offsets + minimum_lag
    pitch_rms = np.sqrt(np.mean(pitch_frames**2, axis=1) + 1e-12)
    pitch_db = 20.0 * np.log10(pitch_rms + 1e-9)
    pitch_active = pitch_db > activity_threshold
    voiced = pitch_active & (periodicity >= 0.34)
    f0 = sample_rate / best_lags[voiced] if np.any(voiced) else np.array([], dtype=np.float64)
    semitones = 12.0 * np.log2(f0 / max(1e-9, float(np.median(f0)))) if f0.size else f0
    pitch_classes = np.mod(12.0 * np.log2(f0 / 440.0), 12.0) if f0.size else f0
    if pitch_classes.size >= 2:
        pitch_steps = np.abs(np.diff(pitch_classes))
        pitch_steps = np.minimum(pitch_steps, 12.0 - pitch_steps)
    else:
        pitch_steps = np.array([], dtype=np.float64)

    # Smooth across short syllabic troughs to describe chant phrases rather than pitch periods.
    phrase_kernel = np.ones(31, dtype=np.float64) / 31.0
    phrase_active = np.convolve(active.astype(np.float64), phrase_kernel, mode="same") >= 0.30
    phrase_runs = [value for value in runs(phrase_active, 0.010) if value >= 0.45]
    onset_peaks, _ = find_peaks(smooth_db, distance=18, prominence=3.0)

    return {
        "duration_seconds": round(samples.size / sample_rate, 3),
        "sample_rate_hz": sample_rate,
        "peak_dbfs": round(peak_dbfs, 2),
        "overall_rms_dbfs": round(overall_dbfs, 2),
        "estimated_noise_floor_dbfs": round(noise_db, 2),
        "speech_level_p78_dbfs": round(speech_db, 2),
        "level_separation_db": round(speech_db - noise_db, 2),
        "speech_activity_percent": round(float(np.mean(active) * 100.0), 2),
        "median_speech_burst_seconds": round(float(np.median(speech_runs)) if speech_runs else 0.0, 3),
        "median_pause_seconds": round(float(np.median(pause_runs)) if pause_runs else 0.0, 3),
        "p90_pause_seconds": round(float(np.percentile(pause_runs, 90)) if pause_runs else 0.0, 3),
        "median_10db_decay_seconds": round(t10, 3),
        "rt60_proxy_seconds": round(t10 * 6.0, 3),
        "usable_decay_events": len(t10_values),
        "voiced_active_frames_percent": round(
            float(np.sum(voiced) / max(1, np.sum(pitch_active)) * 100.0), 2
        ),
        "median_f0_hz": round(float(np.median(f0)), 2) if f0.size else 0.0,
        "pitch_iqr_semitones": round(float(np.percentile(semitones, 75) - np.percentile(semitones, 25)), 2)
        if semitones.size else 0.0,
        "pitch_p10_p90_semitones": round(float(np.percentile(semitones, 90) - np.percentile(semitones, 10)), 2)
        if semitones.size else 0.0,
        "median_pitch_class_step": round(float(np.median(pitch_steps)), 3) if pitch_steps.size else 0.0,
        "estimated_chant_phrases": len(phrase_runs),
        "median_chant_phrase_seconds": round(float(np.median(phrase_runs)), 3) if phrase_runs else 0.0,
        "onset_candidates_per_second": round(float(onset_peaks.size / max(0.001, samples.size / sample_rate)), 3),
        "clipped_samples_percent": round(clipped, 5),
        "interpretation": (
            "high-reverberation/overlap" if t10 >= 0.22
            else "moderate-reverberation" if t10 >= 0.12
            else "comparatively dry or inconclusive"
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("recording", type=Path, nargs="+")
    args = parser.parse_args()
    output = []
    for recording in args.recording:
        resolved = recording.resolve()
        samples = decode_mono_16k(resolved)
        metrics = analyze(samples)
        metrics["file"] = resolved.name
        metrics["sha256"] = hashlib.sha256(resolved.read_bytes()).hexdigest()
        output.append(metrics)
    payload = output[0] if len(output) == 1 else output
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
