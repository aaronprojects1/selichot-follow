const COMMON_HEBREW_WORDS = new Set([
  "את", "של", "על", "אל", "כל", "כי", "לא", "לו", "לנו", "הוא", "היא", "עם", "מן", "מה"
]);

const PROFILE_RANGES = {
  balanced: { back: 5, ahead: 32 },
  echo: { back: 9, ahead: 58 },
  hard: { back: 12, ahead: 86 }
};

export function normalizeHebrew(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/יהוה|אדוני|השם|ה׳|ה'|יי/g, "אדני")
    .replace(/ך/g, "כ")
    .replace(/ם/g, "מ")
    .replace(/ן/g, "נ")
    .replace(/ף/g, "פ")
    .replace(/ץ/g, "צ")
    .replace(/[^\u05d0-\u05ea ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function phoneticSkeleton(text) {
  return compact(text)
    .replace(/[אה]/g, "ע")
    .replace(/[חק]/g, "כ")
    .replace(/ט/g, "ת")
    .replace(/ס/g, "ש")
    .replace(/צ/g, "ז")
    .replace(/ב/g, "ו")
    .replace(/(.)\1+/g, "$1");
}

export function ngramDice(left, right, size) {
  if (left.length < size || right.length < size) return left === right ? 1 : 0;
  const leftGrams = grams(left, size);
  const rightGrams = grams(right, size);
  let leftCount = 0;
  let rightCount = 0;
  let overlap = 0;
  leftGrams.forEach((count) => { leftCount += count; });
  rightGrams.forEach((count) => { rightCount += count; });
  leftGrams.forEach((count, gram) => { overlap += Math.min(count, rightGrams.get(gram) || 0); });
  return (2 * overlap) / Math.max(1, leftCount + rightCount);
}

export function orderedCoverage(spoken, target) {
  const left = spoken.split(/\s+/);
  const right = target.split(/\s+/);
  let matched = 0;
  let cursor = 0;
  left.forEach((token) => {
    if (token.length < 2) return;
    for (let index = cursor; index < right.length; index += 1) {
      if (token === right[index]) {
        matched += 1;
        cursor = index + 1;
        break;
      }
    }
  });
  return matched / Math.max(1, left.length);
}

// Keep this separate and exported so the direction of the prior remains easy to test.
export function positionPrior(delta) {
  if (delta >= 0 && delta <= 5) return 0.045;
  if (delta > 5 && delta <= 14) return 0.02;
  if (delta > 14) return -Math.min(0.08, 0.012 + (delta - 14) * 0.0015);
  if (delta >= -2) return 0.005;
  return -Math.min(0.065, 0.025 + Math.abs(delta + 2) * 0.002);
}

export class PrayerTracker {
  constructor() {
    this.lines = [];
    this.pairs = [];
    this.triples = [];
    this.currentIndex = 0;
    this.profile = "echo";
    this.history = [];
    this.rarity = new Map();
    this.anchorIndex = new Map();
    this.pendingIndex = -1;
    this.pendingHits = 0;
    this.pendingEvidence = new Set();
  }

  setLines(lines) {
    this.lines = (Array.isArray(lines) ? lines : []).map((line) => normalizeHebrew(typeof line === "string" ? line : line?.he));
    this.pairs = buildWindows(this.lines, 2);
    this.triples = buildWindows(this.lines, 3);
    const frequency = new Map();
    this.lines.forEach((line) => {
      uniqueTokens(line).forEach((token) => frequency.set(token, (frequency.get(token) || 0) + 1));
    });
    this.rarity.clear();
    const total = Math.max(1, this.lines.length);
    frequency.forEach((count, token) => this.rarity.set(token, 1 + Math.log(total / count)));
    this.buildAnchorIndex();
    this.currentIndex = clamp(this.currentIndex, 0, Math.max(0, this.lines.length - 1));
    this.clearContext();
  }

  setCurrentIndex(index) {
    this.currentIndex = clamp(Number(index) || 0, 0, Math.max(0, this.lines.length - 1));
    this.clearPending();
  }

  setProfile(profile) {
    this.profile = PROFILE_RANGES[profile] ? profile : "echo";
    this.clearPending();
  }

  clearContext() {
    this.history = [];
    this.clearPending();
  }

  accept(candidates, partialOrOptions = false, acousticInput = {}) {
    const options = typeof partialOrOptions === "object" && partialOrOptions !== null
      ? partialOrOptions
      : { partial: Boolean(partialOrOptions), acoustic: acousticInput };
    const partial = Boolean(options.partial);
    const acoustic = options.acoustic || {};
    const usableCandidates = Array.isArray(candidates) ? candidates.slice(0, 10) : [];
    const evidenceFingerprint = this.evidenceFingerprint(usableCandidates, partial);

    // Acoustic observations can only qualify a textual candidate in this same call.
    // With no words there is deliberately no candidate and therefore no movement.
    if (!this.lines.length || !usableCandidates.length) return this.idleResult();

    let best = null;
    usableCandidates.forEach((candidate) => {
      const original = String(candidate?.transcript || "").trim();
      const spoken = normalizeHebrew(original);
      if (spoken.length < 2) return;
      const confidence = Number.isFinite(candidate?.confidence) && candidate.confidence > 0 ? candidate.confidence : 0.5;
      const match = this.findBest(spoken, confidence, partial);
      match.transcript = original;
      match.normalizedTranscript = spoken;
      if (!best || match.score > best.score || (match.score === best.score && match.textScore > best.textScore)) best = match;
    });

    if (!best) return { ...this.idleResult(), transcript: usableCandidates[0]?.transcript || "" };

    const distance = best.index - this.currentIndex;
    const largeJump = Math.abs(distance) > 7;
    const minimumMargin = this.reanchorMargin();
    const baseThreshold = this.threshold(partial);
    const distinctiveRelief = !best.reanchoring && best.globalMargin >= 0.13 ? 0.08 : 0;
    let eligible = best.score >= baseThreshold - distinctiveRelief;

    if (!best.reanchoring
      && best.index < this.currentIndex - (this.profile === "hard" ? 4 : 2)
      && best.score < 0.86) eligible = false;
    if (largeJump && best.globalMargin < minimumMargin && best.contextSupport < 0.035) eligible = false;
    if (best.reanchoring && (!best.globalWinner || best.textScore < this.reanchorThreshold(partial))) eligible = false;

    let moved = false;
    let awaitingConfirmation = false;
    let acousticConfirmed = false;

    if (eligible && distance !== 0) {
      let hitsNeeded = 1;
      if (best.reanchoring) hitsNeeded = 2;
      if (partial && largeJump && best.score < 0.84) hitsNeeded = Math.max(hitsNeeded, 2);
      if (!partial && Math.abs(distance) > 30 && best.score < 0.72) hitsNeeded = 2;
      if (this.profile === "hard" && partial && best.score < 0.66) hitsNeeded = Math.max(hitsNeeded, 3);

      const hasRecentSpeech = acoustic.recentSpeech === true || acoustic.speech === true;
      const strongBoundary = acoustic.phraseBoundary === true && hasRecentSpeech
        && best.score >= baseThreshold - distinctiveRelief
        && best.globalMargin >= minimumMargin;
      if (strongBoundary && hitsNeeded > 1 && !best.reanchoring) {
        hitsNeeded -= 1;
        acousticConfirmed = true;
      }

      if (hitsNeeded > 1) {
        this.addPendingEvidence(best.index, evidenceFingerprint);
        if (this.pendingHits >= hitsNeeded) {
          moved = this.moveTo(this.pendingIndex);
          this.clearPending();
        } else {
          awaitingConfirmation = true;
        }
      } else {
        moved = this.moveTo(best.index);
        this.clearPending();
      }
    } else if (distance === 0) {
      this.clearPending();
    }

    if (!partial && eligible && (!largeJump || best.globalMargin >= minimumMargin)) {
      this.remember(best.normalizedTranscript);
    }

    return {
      index: this.currentIndex,
      candidateIndex: best.index,
      score: best.score,
      textScore: best.textScore,
      globalMargin: best.globalMargin,
      moved,
      awaitingConfirmation,
      acousticConfirmed,
      reanchoring: best.reanchoring,
      ambiguous: best.globalMargin < minimumMargin,
      evidenceCount: this.pendingHits,
      transcript: best.transcript
    };
  }

  findBest(spoken, confidence = 0.5, partial = false) {
    if (!this.lines.length) return this.emptyMatch();
    const range = PROFILE_RANGES[this.profile] || PROFILE_RANGES.echo;
    const localFrom = Math.max(0, this.currentIndex - range.back);
    const localTo = Math.min(this.lines.length - 1, this.currentIndex + range.ahead);
    const confidenceFactor = 0.94 + 0.06 * confidence;
    const candidateIndices = this.candidateIndices(spoken, localFrom, localTo);
    const entries = candidateIndices.map((index) => {
      const line = this.lines[index];
      const one = line;
      const two = this.pairs[index];
      const three = this.triples[index];
      // Prefer the narrowest matching window so a verse is not reported as the line two
      // positions before it merely because that three-line window contains the words.
      const base = Math.max(
        this.scoreText(spoken, one) + 0.012,
        this.scoreText(spoken, two) + 0.006,
        this.scoreText(spoken, three)
      );
      const contextSupport = this.contextSupport(index);
      const textScore = clamp(base + contextSupport, 0, 1);
      const score = clamp((textScore + positionPrior(index - this.currentIndex)) * confidenceFactor, 0, 1);
      return { index, score, textScore, contextSupport };
    });

    const byGlobalText = [...entries].sort((left, right) =>
      right.textScore - left.textScore
      || Math.abs(left.index - this.currentIndex) - Math.abs(right.index - this.currentIndex)
      || left.index - right.index
    );
    const globalBest = byGlobalText[0] || this.emptyMatch();
    const globalRunner = byGlobalText.find((entry) => Math.abs(entry.index - globalBest.index) > 2);
    const globalMargin = clamp(globalBest.textScore - (globalRunner?.textScore || 0), 0, 1);
    const localEntries = entries.filter((entry) => entry.index >= localFrom && entry.index <= localTo);
    const localBest = localEntries.reduce((best, entry) => !best || entry.score > best.score ? entry : best, null) || globalBest;
    const outsideLocalWindow = globalBest.index < localFrom || globalBest.index > localTo;
    const globalAdvantage = globalBest.textScore - localBest.textScore;
    const globalWinner = globalMargin >= this.reanchorMargin() && globalAdvantage >= 0.055;
    const useGlobal = outsideLocalWindow
      && globalWinner
      && globalBest.textScore >= this.reanchorThreshold(partial);
    const selected = useGlobal ? globalBest : localBest;
    const selectedRunner = byGlobalText.find((entry) => Math.abs(entry.index - selected.index) > 2);
    const selectedMargin = clamp(selected.textScore - (selectedRunner?.textScore || 0), 0, 1);

    return {
      ...selected,
      globalMargin: useGlobal ? globalMargin : selectedMargin,
      globalWinner: useGlobal,
      globalAdvantage,
      reanchoring: useGlobal
    };
  }

  scoreText(spoken, target) {
    if (!spoken || !target) return 0;
    if (spoken === target && spoken.length >= 4) return 0.97;
    if (target.startsWith(spoken) && spoken.length >= 4) return 0.92;
    if (target.includes(spoken) && spoken.length >= 5) return 0.88;
    if (spoken.includes(target) && target.length >= 7) return 0.91;

    const tokenScore = this.weightedTokenF1(spoken, target);
    const gramsScore = ngramDice(compact(spoken), compact(target), 3);
    const phonetic = ngramDice(phoneticSkeleton(spoken), phoneticSkeleton(target), 2);
    const order = orderedCoverage(spoken, target);
    const distinctive = this.distinctiveOverlap(spoken, target) * 0.06;
    return clamp(tokenScore * 0.38 + gramsScore * 0.3 + phonetic * 0.17 + order * 0.15 + distinctive, 0, 1);
  }

  weightedTokenF1(leftText, rightText) {
    const left = uniqueTokens(leftText);
    const right = uniqueTokens(rightText);
    if (!left.size || !right.size) return 0;
    let leftWeight = 0;
    let rightWeight = 0;
    let overlap = 0;
    left.forEach((token) => { leftWeight += this.weight(token); });
    right.forEach((token) => { rightWeight += this.weight(token); });
    left.forEach((token) => { if (right.has(token)) overlap += this.weight(token); });
    const precision = overlap / Math.max(0.001, leftWeight);
    const recall = overlap / Math.max(0.001, Math.min(rightWeight, leftWeight * 1.45));
    return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  }

  distinctiveOverlap(leftText, rightText) {
    const right = uniqueTokens(rightText);
    let best = 0;
    uniqueTokens(leftText).forEach((token) => {
      if (right.has(token)) best = Math.max(best, this.weight(token) - 1);
    });
    return Math.min(1, best / 2.5);
  }

  contextSupport(index) {
    if (!this.history.length) return 0;
    let support = 0;
    const depth = Math.min(3, this.history.length, index);
    for (let offset = 1; offset <= depth; offset += 1) {
      const priorSpeech = this.history[this.history.length - offset];
      const priorLine = this.lines[index - offset];
      const similarity = this.scoreText(priorSpeech, priorLine);
      if (similarity > 0.5) support += ((similarity - 0.5) / 0.5) * (0.055 / offset);
    }
    return Math.min(0.08, support);
  }

  weight(token) {
    let weight = this.rarity.get(token) || 1.5;
    if (COMMON_HEBREW_WORDS.has(token)) weight *= 0.55;
    if (token.length >= 6) weight += 0.15;
    return weight;
  }

  buildAnchorIndex() {
    this.anchorIndex.clear();
    this.lines.forEach((line, index) => {
      uniqueTokens(line).forEach((token) => this.addAnchor(`t:${token}`, index));
      grams(compact(line), 3).forEach((_, gram) => this.addAnchor(`g:${gram}`, index));
      grams(phoneticSkeleton(line), 3).forEach((_, gram) => this.addAnchor(`p:${gram}`, index));
    });
  }

  addAnchor(anchor, index) {
    const posting = this.anchorIndex.get(anchor);
    if (posting) posting.push(index);
    else this.anchorIndex.set(anchor, [index]);
  }

  candidateIndices(spoken, localFrom, localTo) {
    if (this.lines.length <= 240) return this.lines.map((_, index) => index);
    const selected = new Set();
    for (let index = localFrom; index <= localTo; index += 1) selected.add(index);

    const votes = new Map();
    const maximumPosting = Math.max(24, Math.floor(this.lines.length * 0.20));
    const vote = (anchor, value) => {
      const posting = this.anchorIndex.get(anchor);
      if (!posting || posting.length > maximumPosting) return;
      posting.forEach((index) => votes.set(index, (votes.get(index) || 0) + value));
    };

    uniqueTokens(spoken).forEach((token) => vote(`t:${token}`, 3 + Math.min(3, this.weight(token))));
    grams(compact(spoken), 3).forEach((_, gram) => vote(`g:${gram}`, 0.9));
    grams(phoneticSkeleton(spoken), 3).forEach((_, gram) => vote(`p:${gram}`, 0.45));

    [...votes.entries()]
      .sort((left, right) => right[1] - left[1]
        || Math.abs(left[0] - this.currentIndex) - Math.abs(right[0] - this.currentIndex))
      .slice(0, 140)
      .forEach(([index]) => selected.add(index));
    return [...selected].sort((left, right) => left - right);
  }

  threshold(partial) {
    if (this.profile === "balanced") return partial ? 0.57 : 0.45;
    if (this.profile === "hard") return partial ? 0.46 : 0.34;
    return partial ? 0.51 : 0.39;
  }

  reanchorThreshold(partial) {
    if (this.profile === "hard") return partial ? 0.72 : 0.68;
    if (this.profile === "balanced") return partial ? 0.79 : 0.73;
    return partial ? 0.76 : 0.7;
  }

  reanchorMargin() {
    if (this.profile === "balanced") return 0.07;
    if (this.profile === "hard") return 0.045;
    return 0.06;
  }

  evidenceFingerprint(candidates, partial) {
    const alternatives = [...new Set(candidates
      .map((candidate) => normalizeHebrew(candidate?.transcript))
      .filter(Boolean))]
      .sort();
    return `${partial ? "interim" : "final"}:${alternatives.join("|")}`;
  }

  addPendingEvidence(index, fingerprint) {
    if (this.pendingIndex !== index) {
      this.pendingIndex = index;
      this.pendingEvidence.clear();
    }
    if (fingerprint) this.pendingEvidence.add(fingerprint);
    this.pendingHits = this.pendingEvidence.size;
  }

  remember(normalizedTranscript) {
    if (normalizedTranscript && this.history.at(-1) !== normalizedTranscript) this.history.push(normalizedTranscript);
    this.history = this.history.slice(-4);
  }

  moveTo(index) {
    const safeIndex = clamp(index, 0, this.lines.length - 1);
    if (safeIndex === this.currentIndex) return false;
    this.currentIndex = safeIndex;
    return true;
  }

  clearPending() {
    this.pendingIndex = -1;
    this.pendingHits = 0;
    this.pendingEvidence.clear();
  }

  idleResult() {
    return {
      index: this.currentIndex,
      candidateIndex: this.currentIndex,
      score: 0,
      textScore: 0,
      globalMargin: 0,
      moved: false,
      awaitingConfirmation: false,
      acousticConfirmed: false,
      reanchoring: false,
      ambiguous: false,
      evidenceCount: this.pendingHits,
      transcript: ""
    };
  }

  emptyMatch() {
    return {
      index: this.currentIndex,
      score: 0,
      textScore: 0,
      contextSupport: 0,
      globalMargin: 0,
      globalWinner: false,
      globalAdvantage: 0,
      reanchoring: false
    };
  }
}

function compact(text) {
  return text.replace(/\s/g, "");
}

function uniqueTokens(text) {
  return new Set(text.split(/\s+/).filter((token) => token.length >= 2));
}

function grams(text, size) {
  const output = new Map();
  for (let index = 0; index <= text.length - size; index += 1) {
    const gram = text.slice(index, index + size);
    output.set(gram, (output.get(gram) || 0) + 1);
  }
  return output;
}

function buildWindows(lines, count) {
  return lines.map((_, start) => lines.slice(start, start + count).join(" "));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
