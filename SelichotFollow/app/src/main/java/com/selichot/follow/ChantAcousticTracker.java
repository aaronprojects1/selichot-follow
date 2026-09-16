package com.selichot.follow;

/**
 * Lightweight, allocation-free chant activity and phrase-boundary detector.
 *
 * This deliberately does not predict a prayer index. Unlabelled pitch/rhythm can tell us
 * that a new sung phrase began, but repeated melodies cannot identify which verse it is.
 */
final class ChantAcousticTracker {
    static final class Event {
        static final Event NONE = new Event(false, 0, 0);

        final boolean phraseBoundary;
        final double strength;
        final long phraseDurationMs;

        Event(boolean phraseBoundary, double strength, long phraseDurationMs) {
            this.phraseBoundary = phraseBoundary;
            this.strength = strength;
            this.phraseDurationMs = phraseDurationMs;
        }
    }

    private double noiseFloor = 0.12;
    private double peak = 0.42;
    private boolean active;
    private long activeSinceMs;
    private long quietSinceMs;
    private long lastBoundaryMs;
    private long minimumQuietMs = 340;
    private double latestVoicing;
    private double melodyMovement;
    private double lastPitchClass = Double.NaN;

    void reset() {
        noiseFloor = 0.12;
        peak = 0.42;
        active = false;
        activeSinceMs = 0;
        quietSinceMs = 0;
        lastBoundaryMs = 0;
        latestVoicing = 0;
        melodyMovement = 0;
        lastPitchClass = Double.NaN;
    }

    void setMinimumQuietMs(long value) {
        minimumQuietMs = Math.max(240, Math.min(650, value));
    }

    Event acceptLevel(double normalizedLevel, long nowMs) {
        double level = clamp(normalizedLevel, 0, 1);
        peak = Math.max(level, peak * 0.992);
        if (!active || level < noiseFloor + 0.08) {
            double smoothing = level < noiseFloor ? 0.055 : 0.012;
            noiseFloor += (level - noiseFloor) * smoothing;
        }

        double contrast = Math.max(0.10, peak - noiseFloor);
        double enterThreshold = noiseFloor + Math.max(0.065, contrast * 0.30);
        double exitThreshold = noiseFloor + Math.max(0.040, contrast * 0.18);

        if (!active) {
            if (level >= enterThreshold) {
                active = true;
                activeSinceMs = nowMs;
                quietSinceMs = 0;
                melodyMovement *= 0.5;
            }
            return Event.NONE;
        }

        if (level > exitThreshold) {
            quietSinceMs = 0;
            return Event.NONE;
        }
        if (quietSinceMs == 0) quietSinceMs = nowMs;

        long quietDuration = nowMs - quietSinceMs;
        long phraseDuration = quietSinceMs - activeSinceMs;
        if (quietDuration < minimumQuietMs || phraseDuration < 850
                || nowMs - lastBoundaryMs < 1050) {
            return Event.NONE;
        }

        active = false;
        lastBoundaryMs = nowMs;
        quietSinceMs = 0;
        double durationEvidence = clamp((phraseDuration - 850.0) / 3200.0, 0, 1);
        double melodyEvidence = clamp(latestVoicing * 0.6 + melodyMovement * 0.4, 0, 1);
        double strength = clamp(0.58 + durationEvidence * 0.20 + melodyEvidence * 0.16, 0, 1);
        return new Event(true, strength, phraseDuration);
    }

    /**
     * Best-effort periodicity/pitch-class observation for recognizers that expose PCM.
     * Services are allowed not to call onBufferReceived, so level-only operation remains valid.
     */
    void observePcm16(byte[] buffer, int assumedSampleRate) {
        if (buffer == null || buffer.length < 320 || (buffer.length & 1) != 0) return;
        int sampleCount = Math.min(buffer.length / 2, 2048);
        int offsetSamples = Math.max(0, (buffer.length / 2) - sampleCount);
        double energy = 1e-9;
        for (int i = 0; i < sampleCount; i++) {
            double sample = sample(buffer, offsetSamples + i);
            energy += sample * sample;
        }

        int sampleRate = assumedSampleRate > 0 ? assumedSampleRate : 16000;
        int minimumLag = Math.max(12, sampleRate / 420);
        int maximumLag = Math.min(sampleCount / 2, sampleRate / 75);
        double bestCorrelation = 0;
        int bestLag = 0;
        for (int lag = minimumLag; lag <= maximumLag; lag += 2) {
            double numerator = 0;
            double delayedEnergy = 1e-9;
            for (int i = lag; i < sampleCount; i += 2) {
                double current = sample(buffer, offsetSamples + i);
                double delayed = sample(buffer, offsetSamples + i - lag);
                numerator += current * delayed;
                delayedEnergy += delayed * delayed;
            }
            double correlation = numerator / Math.sqrt(energy * delayedEnergy * 0.5);
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestLag = lag;
            }
        }

        latestVoicing = latestVoicing * 0.72 + clamp((bestCorrelation - 0.30) / 0.55, 0, 1) * 0.28;
        if (bestLag == 0 || bestCorrelation < 0.38) return;
        double pitchHz = (double) sampleRate / bestLag;
        double pitchClass = modulo(12.0 * (Math.log(pitchHz / 440.0) / Math.log(2.0)), 12.0);
        if (!Double.isNaN(lastPitchClass)) {
            double distance = Math.abs(pitchClass - lastPitchClass);
            distance = Math.min(distance, 12.0 - distance);
            melodyMovement = melodyMovement * 0.76 + clamp(distance / 3.0, 0, 1) * 0.24;
        }
        lastPitchClass = pitchClass;
    }

    private static double sample(byte[] buffer, int sampleIndex) {
        int byteIndex = sampleIndex * 2;
        int low = buffer[byteIndex] & 0xff;
        int high = buffer[byteIndex + 1];
        return (short) (low | (high << 8)) / 32768.0;
    }

    private static double modulo(double value, double modulus) {
        return ((value % modulus) + modulus) % modulus;
    }

    private static double clamp(double value, double minimum, double maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }
}
