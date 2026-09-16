package com.selichot.follow;

import java.text.Normalizer;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Stateful Hebrew prayer matcher. It deliberately keeps Android APIs out so the
 * scoring logic can be exercised with ordinary JVM tests.
 */
final class TrackingEngine {
    enum RoomProfile {
        BALANCED,
        REVERBERANT,
        HARD_TO_HEAR
    }

    static final class Result {
        final int index;
        final double score;
        final double margin;
        final boolean moved;
        final boolean awaitingConfirmation;
        final boolean reanchored;
        final String transcript;

        Result(int index, double score, boolean moved, boolean awaitingConfirmation, String transcript) {
            this(index, score, 0, moved, awaitingConfirmation, false, transcript);
        }

        Result(int index, double score, double margin, boolean moved,
               boolean awaitingConfirmation, boolean reanchored, String transcript) {
            this.index = index;
            this.score = score;
            this.margin = margin;
            this.moved = moved;
            this.awaitingConfirmation = awaitingConfirmation;
            this.reanchored = reanchored;
            this.transcript = transcript;
        }
    }

    private static final Set<String> COMMON_WORDS = new HashSet<>(Arrays.asList(
            "את", "של", "על", "אל", "כל", "כי", "לא", "לו", "לנו", "הוא", "היא", "עם", "מן", "מה"
    ));

    private final ArrayDeque<String> finalHistory = new ArrayDeque<>();
    private final Map<String, Double> tokenRarity = new HashMap<>();
    private final Map<String, List<Integer>> anchorIndex = new HashMap<>();
    private List<String> normalizedLines = Collections.emptyList();
    private List<String> normalizedPairs = Collections.emptyList();
    private List<String> normalizedTriples = Collections.emptyList();
    private int currentIndex;
    private int pendingIndex = -1;
    private int pendingHits;
    private String lastEvidenceKey = "";
    private int lastEvidenceEpoch = -1;
    private int acousticEpoch;
    private RoomProfile roomProfile = RoomProfile.REVERBERANT;
    private volatile double ambientNoise;
    private volatile double signalContrast = 0.5;

    synchronized void setLines(List<PrayerLine> lines) {
        List<String> next = new ArrayList<>();
        Map<String, Integer> frequency = new HashMap<>();
        for (PrayerLine line : lines) {
            String normalized = normalizeHebrew(line.hebrew);
            next.add(normalized);
            for (String token : uniqueTokens(normalized)) {
                frequency.put(token, frequency.getOrDefault(token, 0) + 1);
            }
        }
        normalizedLines = next;
        normalizedPairs = buildWindows(next, 2);
        normalizedTriples = buildWindows(next, 3);
        tokenRarity.clear();
        int total = Math.max(1, next.size());
        for (Map.Entry<String, Integer> entry : frequency.entrySet()) {
            tokenRarity.put(entry.getKey(), 1.0 + Math.log((double) total / entry.getValue()));
        }
        buildAnchorIndex();
        setCurrentIndex(currentIndex);
        clearContext();
    }

    synchronized void setCurrentIndex(int index) {
        if (normalizedLines.isEmpty()) {
            currentIndex = 0;
        } else {
            currentIndex = Math.max(0, Math.min(index, normalizedLines.size() - 1));
        }
        pendingIndex = -1;
        pendingHits = 0;
    }

    synchronized int getCurrentIndex() {
        return currentIndex;
    }

    synchronized void setRoomProfile(RoomProfile profile) {
        roomProfile = profile == null ? RoomProfile.REVERBERANT : profile;
        pendingIndex = -1;
        pendingHits = 0;
    }

    void setAmbientNoise(double normalizedNoise) {
        ambientNoise = clamp(normalizedNoise, 0.0, 1.0);
    }

    void setSignalContrast(double normalizedContrast) {
        signalContrast = clamp(normalizedContrast, 0.0, 1.0);
    }

    synchronized void clearContext() {
        finalHistory.clear();
        pendingIndex = -1;
        pendingHits = 0;
        lastEvidenceKey = "";
        lastEvidenceEpoch = -1;
        acousticEpoch = 0;
    }

    /**
     * Records a strong, newly observed chant boundary. Rhythm/melody never chooses a
     * prayer by itself; it only makes a repeated partial transcript independent evidence.
     */
    synchronized void noteAcousticBoundary(double strength) {
        if (strength >= 0.58) acousticEpoch++;
    }

    synchronized Result accept(List<String> candidates, float[] recognizerConfidence, boolean partial) {
        if (normalizedLines.isEmpty() || candidates == null || candidates.isEmpty()) {
            return new Result(currentIndex, 0, false, false, "");
        }

        Candidate best = null;
        List<String> history = new ArrayList<>(finalHistory);
        int candidateLimit = Math.min(10, candidates.size());
        for (int i = 0; i < candidateLimit; i++) {
            String original = candidates.get(i) == null ? "" : candidates.get(i).trim();
            String spoken = normalizeHebrew(original);
            if (spoken.length() < 2) continue;
            double serviceConfidence = confidenceAt(recognizerConfidence, i);
            Candidate direct = findBest(spoken, original, serviceConfidence);
            if (best == null || direct.score > best.score) best = direct;

            // Low-contrast chanting is commonly split at arbitrary boundaries. Score every
            // suffix of the last three final fragments so stale context cannot dominate.
            for (int window = 1; window <= history.size(); window++) {
                StringBuilder context = new StringBuilder();
                for (int h = history.size() - window; h < history.size(); h++) {
                    if (context.length() > 0) context.append(' ');
                    context.append(history.get(h));
                }
                context.append(' ').append(spoken);
                String rolling = normalizeHebrew(context.toString());
                Candidate contextual = findBest(rolling, original, serviceConfidence);
                contextual.score = Math.min(1.0, contextual.score + (0.03 - window * 0.008));
                if (best == null || contextual.score > best.score) best = contextual;
            }
        }

        if (best == null) return new Result(currentIndex, 0, false, false, candidates.get(0));

        double threshold = threshold(partial);
        boolean eligible = best.score >= threshold
                || (!best.reanchored && best.margin >= 0.13 && best.score >= threshold - 0.08);
        if (best.reanchored) {
            double globalThreshold = globalThreshold(partial);
            double requiredMargin = best.score >= 0.88 ? 0.035 : 0.065;
            eligible = best.score >= globalThreshold && best.margin >= requiredMargin;
        }
        boolean backward = best.index < currentIndex - backwardAllowance();
        if (backward && !best.reanchored && best.score < 0.86) eligible = false;

        boolean moved = false;
        boolean awaitingConfirmation = false;
        if (eligible) {
            int distance = best.index - currentIndex;
            boolean repeatedRegion = Math.abs(best.index - pendingIndex) <= 2;
            int requiredHits = requiredConfirmationHits(distance, best, partial);
            String evidenceKey = (partial ? "P|" : "F|") + best.index + "|" + best.normalizedTranscript;
            boolean freshEvidence = !evidenceKey.equals(lastEvidenceKey)
                    || acousticEpoch != lastEvidenceEpoch;

            if (requiredHits > 1) {
                if (repeatedRegion) {
                    if (freshEvidence) pendingHits++;
                    if (best.index > pendingIndex) pendingIndex = best.index;
                } else {
                    pendingIndex = best.index;
                    pendingHits = 1;
                }
                lastEvidenceKey = evidenceKey;
                lastEvidenceEpoch = acousticEpoch;
                if (pendingHits >= requiredHits) {
                    moved = moveTo(pendingIndex);
                    pendingIndex = -1;
                    pendingHits = 0;
                } else {
                    awaitingConfirmation = true;
                }
            } else {
                moved = moveTo(best.index);
                pendingIndex = -1;
                pendingHits = 0;
            }
        }

        // Garbage finals used to poison the rolling context and made the next result slower.
        // Only retain a transcript that actually cleared the matcher safeguards.
        if (!partial && eligible) rememberFinal(normalizeHebrew(best.originalTranscript));
        return new Result(currentIndex, best.score, best.margin, moved, awaitingConfirmation,
                moved && best.reanchored, best.originalTranscript);
    }

    private Candidate findBest(String spoken, String original, double serviceConfidence) {
        int back;
        int ahead;
        switch (roomProfile) {
            case BALANCED:
                back = 5;
                ahead = 32;
                break;
            case HARD_TO_HEAR:
                back = 12;
                ahead = 86;
                break;
            case REVERBERANT:
            default:
                back = 9;
                ahead = 58;
                break;
        }

        int from = Math.max(0, currentIndex - back);
        int to = Math.min(normalizedLines.size() - 1, currentIndex + ahead);
        Candidate local = findBestInRange(spoken, original, serviceConfidence, from, to, true);

        // A low local score means the saved/manual position may be wrong. Search the whole
        // service so a distinctive phrase can acquire the correct place immediately.
        double reacquireFloor = spoken.length() >= 7 ? 0.62 : 0.72;
        if (local.score >= reacquireFloor || (from == 0 && to == normalizedLines.size() - 1)) {
            return local;
        }

        List<Integer> globalCandidates = globalCandidateIndices(spoken);
        if (globalCandidates.isEmpty()) return local;
        Candidate global = findBestAtIndices(spoken, original, serviceConfidence,
                globalCandidates, false);
        if (global.score > local.score + 0.015 && global.index > currentIndex) {
            global.reanchored = global.index < from || global.index > to;
            return global;
        }
        return local;
    }

    private Candidate findBestInRange(String spoken, String original, double serviceConfidence,
                                      int from, int to, boolean usePositionPrior) {
        List<Integer> indices = new ArrayList<>();
        for (int i = from; i <= to; i++) indices.add(i);
        return findBestAtIndices(spoken, original, serviceConfidence, indices, usePositionPrior);
    }

    private Candidate findBestAtIndices(String spoken, String original, double serviceConfidence,
                                        List<Integer> indices, boolean usePositionPrior) {
        List<Candidate> scored = new ArrayList<>();
        double confidenceFactor = 0.94 + (0.06 * serviceConfidence);
        for (int i : indices) {
            String one = normalizedLines.get(i);
            String two = normalizedPairs.get(i);
            String three = normalizedTriples.get(i);
            // Prefer the narrowest window when scores tie. Otherwise a phrase contained in
            // line N could be reported as N-2 merely because that three-line window includes it.
            double oneScore = scoreText(spoken, one);
            double twoScore = scoreText(spoken, two);
            double threeScore = scoreText(spoken, three);
            double raw = Math.max(oneScore + 0.012, Math.max(twoScore + 0.006, threeScore));
            double positional = usePositionPrior ? positionPrior(i) : 0;
            double score = clamp((raw + positional) * confidenceFactor, 0, 1);
            scored.add(new Candidate(i, score, original, spoken));
        }

        if (scored.isEmpty()) return new Candidate(currentIndex, 0, original, spoken);
        scored.sort((left, right) -> Double.compare(right.score, left.score));
        Candidate best = scored.get(0);
        double runnerUp = 0;
        for (int i = 1; i < scored.size(); i++) {
            Candidate alternative = scored.get(i);
            // Adjacent starts usually describe the same 2-3 line target window.
            if (Math.abs(alternative.index - best.index) > 2) {
                runnerUp = alternative.score;
                break;
            }
        }
        best.margin = Math.max(0, best.score - runnerUp);
        return best;
    }

    private double scoreText(String spoken, String target) {
        if (spoken.isEmpty() || target.isEmpty()) return 0;
        if (spoken.equals(target)) return 1.0;
        if (target.contains(spoken) && spoken.length() >= 7) return 0.94;
        if (spoken.contains(target) && target.length() >= 7) return 0.91;

        double token = weightedTokenF1(spoken, target);
        double grams = ngramDice(compact(spoken), compact(target), 3);
        double phonetic = ngramDice(phoneticSkeleton(spoken), phoneticSkeleton(target), 2);
        double order = orderedTokenCoverage(spoken, target);
        double edit = 0;
        String compactSpoken = compact(spoken);
        String compactTarget = compact(target);
        if (Math.min(compactSpoken.length(), compactTarget.length()) <= 42) {
            int maxLength = Math.max(compactSpoken.length(), compactTarget.length());
            edit = maxLength == 0 ? 0 : 1.0 - ((double) levenshtein(compactSpoken, compactTarget) / maxLength);
        }

        double distinctiveBonus = distinctiveOverlap(spoken, target) * 0.06;
        return clamp(token * 0.34 + grams * 0.28 + phonetic * 0.16 + order * 0.14 + edit * 0.08 + distinctiveBonus, 0, 1);
    }

    private double weightedTokenF1(String a, String b) {
        Set<String> left = uniqueTokens(a);
        Set<String> right = uniqueTokens(b);
        if (left.isEmpty() || right.isEmpty()) return 0;
        double leftWeight = 0;
        double rightWeight = 0;
        double overlap = 0;
        for (String token : left) leftWeight += weight(token);
        for (String token : right) rightWeight += weight(token);
        for (String token : left) if (right.contains(token)) overlap += weight(token);
        double precision = overlap / Math.max(0.001, leftWeight);
        double recall = overlap / Math.max(0.001, Math.min(rightWeight, leftWeight * 1.45));
        return (precision + recall) == 0 ? 0 : (2 * precision * recall) / (precision + recall);
    }

    private double distinctiveOverlap(String a, String b) {
        double best = 0;
        Set<String> right = uniqueTokens(b);
        for (String token : uniqueTokens(a)) {
            if (right.contains(token)) best = Math.max(best, weight(token) - 1.0);
        }
        return Math.min(1.0, best / 2.5);
    }

    private double orderedTokenCoverage(String spoken, String target) {
        String[] a = spoken.split("\\s+");
        String[] b = target.split("\\s+");
        if (a.length == 0 || b.length == 0) return 0;
        int matched = 0;
        int cursor = 0;
        for (String token : a) {
            if (token.length() < 2) continue;
            for (int j = cursor; j < b.length; j++) {
                if (token.equals(b[j])) {
                    matched++;
                    cursor = j + 1;
                    break;
                }
            }
        }
        return (double) matched / Math.max(1, a.length);
    }

    private double positionPrior(int index) {
        int delta = index - currentIndex;
        if (delta >= 0 && delta <= 5) return 0.045;
        if (delta > 5 && delta <= 14) return 0.02;
        if (delta < 0 && delta >= -2) return 0.005;
        if (delta < -2) return -0.035;
        return -Math.min(0.055, (delta - 14) * 0.0015);
    }

    private double threshold(boolean partial) {
        double base;
        switch (roomProfile) {
            case BALANCED:
                base = partial ? 0.57 : 0.45;
                break;
            case HARD_TO_HEAR:
                base = partial ? 0.46 : 0.34;
                break;
            case REVERBERANT:
            default:
                base = partial ? 0.51 : 0.39;
                break;
        }
        // In a noisy room demand more evidence, but recover a little sensitivity when the
        // measured speech/background separation is as low as the development recordings.
        double noiseCaution = Math.max(0, ambientNoise - 0.72) * 0.09;
        double lowContrastRelief = Math.max(0, 0.24 - signalContrast) * 0.10;
        return base + noiseCaution - lowContrastRelief;
    }

    private double globalThreshold(boolean partial) {
        switch (roomProfile) {
            case BALANCED: return partial ? 0.64 : 0.52;
            case HARD_TO_HEAR: return partial ? 0.56 : 0.45;
            case REVERBERANT:
            default: return partial ? 0.60 : 0.49;
        }
    }

    private int requiredConfirmationHits(int distance, Candidate candidate, boolean partial) {
        if (candidate.reanchored) {
            // A refrain can legitimately recur. Never let a single callback pull the service
            // far backward; a changed transcript or a new acoustic phrase must confirm it.
            if (distance < 0) return 2;
            if (partial) {
                return candidate.score >= 0.90 && candidate.margin >= 0.10 ? 1 : 2;
            }
            return candidate.score >= 0.55 && candidate.margin >= 0.09 ? 1 : 2;
        }
        if (candidate.score >= 0.82) return 1;
        if (signalContrast < 0.24 && Math.abs(distance) >= 4 && partial) return 2;
        if (partial && distance > immediateForwardWindow()) return 2;
        if (distance > 32 && candidate.score < 0.68) return 2;
        return 1;
    }

    private int immediateForwardWindow() {
        switch (roomProfile) {
            case BALANCED: return 8;
            case HARD_TO_HEAR: return 6;
            case REVERBERANT:
            default: return 7;
        }
    }

    private int backwardAllowance() {
        return roomProfile == RoomProfile.HARD_TO_HEAR ? 4 : 2;
    }

    private boolean moveTo(int index) {
        int safe = Math.max(0, Math.min(index, normalizedLines.size() - 1));
        if (safe == currentIndex) return false;
        currentIndex = safe;
        return true;
    }

    private void rememberFinal(String normalized) {
        if (normalized == null || normalized.length() < 2) return;
        if (!finalHistory.isEmpty() && finalHistory.peekLast().equals(normalized)) return;
        finalHistory.addLast(normalized);
        while (finalHistory.size() > 3) finalHistory.removeFirst();
    }

    private static List<String> buildWindows(List<String> source, int count) {
        List<String> windows = new ArrayList<>();
        for (int start = 0; start < source.size(); start++) {
            StringBuilder builder = new StringBuilder();
            for (int i = start; i < source.size() && i < start + count; i++) {
                if (builder.length() > 0) builder.append(' ');
                builder.append(source.get(i));
            }
            windows.add(builder.toString());
        }
        return windows;
    }

    private void buildAnchorIndex() {
        anchorIndex.clear();
        for (int index = 0; index < normalizedLines.size(); index++) {
            String line = normalizedLines.get(index);
            for (String token : uniqueTokens(line)) addAnchor("t:" + token, index);
            for (String gram : grams(compact(line), 3).keySet()) addAnchor("g:" + gram, index);
            for (String gram : grams(phoneticSkeleton(line), 3).keySet()) addAnchor("p:" + gram, index);
        }
    }

    private void addAnchor(String anchor, int index) {
        anchorIndex.computeIfAbsent(anchor, ignored -> new ArrayList<>()).add(index);
    }

    private List<Integer> globalCandidateIndices(String spoken) {
        if (normalizedLines.size() <= 240) {
            List<Integer> all = new ArrayList<>();
            for (int i = 0; i < normalizedLines.size(); i++) all.add(i);
            return all;
        }

        Map<Integer, Double> votes = new HashMap<>();
        int maximumPosting = Math.max(24, (int) (normalizedLines.size() * 0.20));
        for (String token : uniqueTokens(spoken)) {
            addVotes(votes, "t:" + token, 3.0 + Math.min(3.0, weight(token)), maximumPosting);
        }
        for (String gram : grams(compact(spoken), 3).keySet()) {
            addVotes(votes, "g:" + gram, 0.9, maximumPosting);
        }
        for (String gram : grams(phoneticSkeleton(spoken), 3).keySet()) {
            addVotes(votes, "p:" + gram, 0.45, maximumPosting);
        }

        List<Map.Entry<Integer, Double>> ranked = new ArrayList<>(votes.entrySet());
        ranked.sort((left, right) -> {
            int scoreOrder = Double.compare(right.getValue(), left.getValue());
            if (scoreOrder != 0) return scoreOrder;
            return Integer.compare(Math.abs(left.getKey() - currentIndex),
                    Math.abs(right.getKey() - currentIndex));
        });
        List<Integer> selected = new ArrayList<>();
        for (int i = 0; i < ranked.size() && i < 140; i++) selected.add(ranked.get(i).getKey());
        return selected;
    }

    private void addVotes(Map<Integer, Double> votes, String anchor,
                          double value, int maximumPosting) {
        List<Integer> posting = anchorIndex.get(anchor);
        if (posting == null || posting.size() > maximumPosting) return;
        for (int index : posting) votes.put(index, votes.getOrDefault(index, 0.0) + value);
    }

    private double confidenceAt(float[] values, int index) {
        if (values == null || index >= values.length || values[index] < 0) return 0.5;
        return clamp(values[index], 0, 1);
    }

    private double weight(String token) {
        double rarity = tokenRarity.getOrDefault(token, 1.5);
        if (COMMON_WORDS.contains(token)) rarity *= 0.55;
        if (token.length() >= 6) rarity += 0.15;
        return rarity;
    }

    static String normalizeHebrew(String input) {
        if (input == null) return "";
        String value = Normalizer.normalize(input, Normalizer.Form.NFD)
                .replaceAll("[\\u0591-\\u05C7]", "")
                .replace("יהוה", "אדני")
                .replace("אדוני", "אדני")
                .replace("השם", "אדני")
                .replace("ה׳", "אדני")
                .replace("ה'", "אדני")
                .replace("יי", "אדני")
                .replace('\u05DA', '\u05DB')
                .replace('\u05DD', '\u05DE')
                .replace('\u05DF', '\u05E0')
                .replace('\u05E3', '\u05E4')
                .replace('\u05E5', '\u05E6')
                .replaceAll("[^\\u05D0-\\u05EA ]", " ")
                .replaceAll("\\s+", " ")
                .trim();
        return value;
    }

    /** Maps common recognizer confusions to nearby articulatory families. */
    private static String phoneticSkeleton(String text) {
        return compact(text)
                .replace('\u05D0', '\u05E2') // א / ע
                .replace('\u05D4', '\u05E2') // ה / ע
                .replace('\u05D7', '\u05DB') // ח / כ
                .replace('\u05E7', '\u05DB') // ק / כ
                .replace('\u05D8', '\u05EA') // ט / ת
                .replace('\u05E1', '\u05E9') // ס / ש
                .replace('\u05E6', '\u05D6') // צ / ז
                .replace('\u05D1', '\u05D5') // ב / ו
                .replaceAll("(.)\\1+", "$1");
    }

    private static String compact(String text) {
        return text.replace(" ", "");
    }

    private static Set<String> uniqueTokens(String text) {
        Set<String> out = new HashSet<>();
        for (String token : text.split("\\s+")) if (token.length() >= 2) out.add(token);
        return out;
    }

    private static double ngramDice(String a, String b, int size) {
        if (a.length() < size || b.length() < size) return a.equals(b) ? 1 : 0;
        Map<String, Integer> left = grams(a, size);
        Map<String, Integer> right = grams(b, size);
        int leftCount = 0;
        int rightCount = 0;
        int overlap = 0;
        for (int value : left.values()) leftCount += value;
        for (int value : right.values()) rightCount += value;
        for (Map.Entry<String, Integer> entry : left.entrySet()) {
            overlap += Math.min(entry.getValue(), right.getOrDefault(entry.getKey(), 0));
        }
        return (2.0 * overlap) / Math.max(1, leftCount + rightCount);
    }

    private static Map<String, Integer> grams(String text, int size) {
        Map<String, Integer> grams = new HashMap<>();
        for (int i = 0; i <= text.length() - size; i++) {
            String gram = text.substring(i, i + size);
            grams.put(gram, grams.getOrDefault(gram, 0) + 1);
        }
        return grams;
    }

    private static int levenshtein(String left, String right) {
        int[] previous = new int[right.length() + 1];
        int[] current = new int[right.length() + 1];
        for (int j = 0; j <= right.length(); j++) previous[j] = j;
        for (int i = 1; i <= left.length(); i++) {
            current[0] = i;
            for (int j = 1; j <= right.length(); j++) {
                int cost = left.charAt(i - 1) == right.charAt(j - 1) ? 0 : 1;
                current[j] = Math.min(Math.min(current[j - 1] + 1, previous[j] + 1), previous[j - 1] + cost);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[right.length()];
    }

    private static double clamp(double value, double min, double max) {
        return Math.max(min, Math.min(max, value));
    }

    private static final class Candidate {
        final int index;
        double score;
        double margin;
        boolean reanchored;
        final String originalTranscript;
        final String normalizedTranscript;

        Candidate(int index, double score, String originalTranscript, String normalizedTranscript) {
            this.index = index;
            this.score = score;
            this.originalTranscript = originalTranscript;
            this.normalizedTranscript = normalizedTranscript;
        }
    }
}
