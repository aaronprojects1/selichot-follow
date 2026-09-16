const DEFAULT_WINDOW_FRAMES = 18;
// Congregational tempo varies substantially between rooms and chazzanim.
const SPEEDS = [0.72, 0.85, 1, 1.18, 1.35];

export class ChantReferenceMatcher {
  constructor({ windowFrames = DEFAULT_WINDOW_FRAMES } = {}) {
    this.windowFrames = windowFrames;
    this.chromaBins = 12;
    this.spectralBands = 18;
    this.references = [];
    this.liveFrames = [];
    this.pendingKey = "";
    this.pendingHits = 0;
    this.pendingMisses = 0;
    this.lastStableKey = "";
    this.lastStableReferenceId = "";
    this.lastStableEndpoint = -1;
    this.scoreScratch = {
      referenceAggregate: new Float64Array(this.chromaBins),
      liveAggregate: new Float64Array(this.chromaBins)
    };
  }

  load(payload) {
    if (!payload || !Array.isArray(payload.references)) throw new Error("Invalid chant reference payload");
    this.chromaBins = Number(payload.chromaBins) || 12;
    this.spectralBands = Number(payload.spectralBands) || 18;
    this.scoreScratch = {
      referenceAggregate: new Float64Array(this.chromaBins),
      liveAggregate: new Float64Array(this.chromaBins)
    };
    const dimensions = this.chromaBins + this.spectralBands;
    this.references = payload.references.map((source) => {
      const bytes = decodeBase64(source.features);
      if (bytes.length !== source.frames * dimensions) throw new Error(`Invalid feature length for ${source.id}`);
      const vectors = new Float32Array(bytes.length);
      for (let frame = 0; frame < source.frames; frame += 1) {
        const offset = frame * dimensions;
        let chromaNorm = 0;
        for (let index = 0; index < this.chromaBins; index += 1) {
          const value = bytes[offset + index] / 255;
          vectors[offset + index] = value;
          chromaNorm += value * value;
        }
        chromaNorm = Math.sqrt(chromaNorm) || 1;
        for (let index = 0; index < this.chromaBins; index += 1) vectors[offset + index] /= chromaNorm;

        let bandNorm = 0;
        for (let index = 0; index < this.spectralBands; index += 1) {
          const value = bytes[offset + this.chromaBins + index] / 127.5 - 1;
          vectors[offset + this.chromaBins + index] = value;
          bandNorm += value * value;
        }
        bandNorm = Math.sqrt(bandNorm) || 1;
        for (let index = 0; index < this.spectralBands; index += 1) {
          vectors[offset + this.chromaBins + index] /= bandNorm;
        }
      }
      return {
        id: source.id,
        family: source.family || source.id,
        label: source.label,
        frames: Number(source.frames),
        dimensions,
        vectors,
        cues: source.cues.map((cue) => ({ ...cue, lineIndex: -1 }))
      };
    });
    this.reset();
  }

  setLines(lines) {
    const normalizedLines = (lines || []).map((line) => normalizeHebrew(line?.he || line || ""));
    this.references.forEach((reference) => {
      let previous = -1;
      reference.cues.forEach((cue) => {
        const anchor = normalizeHebrew(cue.anchor);
        let found = -1;
        const start = Math.max(0, previous + 1);
        const end = previous >= 0 ? Math.min(normalizedLines.length, previous + 14) : normalizedLines.length;
        for (let index = start; index < end; index += 1) {
          if (anchorMatches(normalizedLines[index], anchor)) {
            found = index;
            break;
          }
        }
        if (found < 0 && previous < 0) {
          found = normalizedLines.findIndex((line) => anchorMatches(line, anchor));
        }
        cue.lineIndex = found;
        if (found >= 0) previous = found;
      });
    });
    this.reset();
  }

  reset() {
    this.liveFrames = [];
    this.pendingKey = "";
    this.pendingHits = 0;
    this.pendingMisses = 0;
    this.lastStableKey = "";
    this.lastStableReferenceId = "";
    this.lastStableEndpoint = -1;
  }

  observe(chromaInput, bandInput) {
    if (!this.references.length) return emptyResult();
    const chroma = normalizedVector(chromaInput, this.chromaBins);
    const bands = normalizedVector(bandInput, this.spectralBands);
    if (!chroma || !bands) return emptyResult();
    this.liveFrames.push({ chroma, bands });
    if (this.liveFrames.length > this.windowFrames) this.liveFrames.shift();
    if (this.liveFrames.length < Math.min(12, this.windowFrames)) return emptyResult();

    const live = this.liveFrames;
    const liveAggregate = this.scoreScratch.liveAggregate;
    liveAggregate.fill(0);
    for (const frame of live) {
      for (let pitch = 0; pitch < this.chromaBins; pitch += 1) {
        liveAggregate[pitch] += frame.chroma[pitch];
      }
    }
    const bestByRegion = new Map();
    for (const reference of this.references) {
      // Endpoint validity depends on the candidate speed. Starting every scan
      // at the fastest speed's minimum hides the beginning of a reference from
      // slower candidates (including the normal 1x path) during cold start.
      const minimumEndpoint = Math.ceil((live.length - 1) * Math.min(...SPEEDS));
      const sameLockedPerformance = reference.id === this.lastStableReferenceId;
      const endpointStart = sameLockedPerformance
        ? Math.max(minimumEndpoint, this.lastStableEndpoint - 3)
        : minimumEndpoint;
      const endpointEnd = sameLockedPerformance
        ? Math.min(reference.frames, this.lastStableEndpoint + 31)
        : reference.frames;
      // Acquisition must inspect every endpoint while the first short window is
      // filling.  A stride of two made clean input alternate between a strong
      // endpoint and the gap beside it, repeatedly destroying consensus before
      // the matcher could lock.
      const endpointStep = sameLockedPerformance
        ? 1
        : this.lastStableReferenceId
          ? 4
          : live.length < this.windowFrames ? 1 : 2;
      for (let endpoint = endpointStart; endpoint < endpointEnd; endpoint += endpointStep) {
        const cueIndex = cueForFrame(reference.cues, endpoint);
        if (cueIndex < 0 || reference.cues[cueIndex].lineIndex < 0) continue;
        for (const speed of SPEEDS) {
          if (endpoint < Math.ceil((live.length - 1) * speed)) continue;
          if (reference.id === this.lastStableReferenceId && endpoint < this.lastStableEndpoint - 3) continue;
          const candidate = scoreCandidate(
            reference,
            endpoint,
            speed,
            live,
            this.chromaBins,
            this.spectralBands,
            this.scoreScratch
          );
          if (reference.id === this.lastStableReferenceId) {
            const continuityDelta = Math.abs(endpoint - (this.lastStableEndpoint + 1));
            candidate.score -= Math.min(0.08, continuityDelta * 0.0015);
          }
          candidate.cueIndex = cueIndex;
          candidate.lineIndex = reference.cues[cueIndex].lineIndex;
          candidate.key = `${reference.id}:${cueIndex}`;
          const previous = bestByRegion.get(candidate.key);
          if (!previous || candidate.score > previous.score) bestByRegion.set(candidate.key, candidate);
        }
      }
    }

    const coarseRanked = [...bestByRegion.values()].sort((left, right) => right.score - left.score);
    // Delta-chroma is channel/room robust but more expensive. Refine only the
    // strongest coarse regions instead of doing this work at every endpoint.
    const refineCount = Math.min(24, coarseRanked.length);
    for (let index = 0; index < coarseRanked.length; index += 1) {
      const candidate = coarseRanked[index];
      const movementScore = index < refineCount
        ? scoreMovement(candidate, live, this.chromaBins)
        : 0.5;
      candidate.score = 0.78 * candidate.score + 0.22 * movementScore;
    }
    const ranked = coarseRanked.sort((left, right) => right.score - left.score);
    const best = ranked[0];
    if (!best) return emptyResult();
    // Adjacent cue regions describe the same continuous performance. Do not let
    // their shared boundary delay recognizing an otherwise distinctive chant.
    const second = ranked.find((candidate) => (
      candidate.reference.family !== best.reference.family
      || (candidate.reference.id === best.reference.id
        && Math.abs(candidate.cueIndex - best.cueIndex) > 1)
    ));
    const margin = best.score - (second?.score || 0);
    const eligible = best.score >= 0.73 && margin >= 0.045;
    const stableEligible = best.score >= 0.76 && margin >= 0.055;

    if (stableEligible) {
      if (best.key === this.pendingKey) this.pendingHits += 1;
      else {
        this.pendingKey = best.key;
        this.pendingHits = 1;
      }
      this.pendingMisses = 0;
    } else if (best.key === this.pendingKey && this.pendingHits > 0 && best.score >= 0.68) {
      // Coarse endpoint strides can put every other live frame between two
      // stored frames. Preserve one near-miss instead of destroying consensus.
      this.pendingMisses += 1;
      if (this.pendingMisses > 1) {
        this.pendingKey = "";
        this.pendingHits = 0;
        this.pendingMisses = 0;
      }
    } else {
      this.pendingKey = "";
      this.pendingHits = 0;
      this.pendingMisses = 0;
    }

    // A very distinctive match gets a two-frame confirmation. Lower-margin
    // rooms retain three confirmations to prevent music/noise false positives.
    const requiredHits = best.score >= 0.86 && margin >= 0.08 ? 2 : 3;
    const stable = stableEligible && this.pendingHits >= requiredHits;
    if (stable) {
      this.lastStableKey = best.key;
      if (this.lastStableReferenceId === best.reference.id) {
        this.lastStableEndpoint = Math.max(this.lastStableEndpoint, best.endpoint);
      } else {
        this.lastStableReferenceId = best.reference.id;
        this.lastStableEndpoint = best.endpoint;
      }
    }
    return {
      matched: eligible,
      stable,
      index: best.lineIndex,
      referenceId: best.reference.id,
      family: best.reference.family,
      label: best.reference.label,
      cue: best.reference.cues[best.cueIndex].anchor,
      score: best.score,
      margin,
      evidence: this.pendingHits,
      requiredHits,
      locked: Boolean(this.lastStableKey && best.reference.id === this.lastStableReferenceId)
    };
  }

  getCoverage() {
    return this.references.map((reference) => {
      const mapped = reference.cues.filter((cue) => cue.lineIndex >= 0).length;
      return {
        id: reference.id,
        label: reference.label,
        mapped,
        total: reference.cues.length,
        unmapped: reference.cues
          .filter((cue) => cue.lineIndex < 0)
          .map((cue) => cue.anchor)
      };
    });
  }
}

function scoreCandidate(reference, endpoint, speed, live, chromaBins, spectralBands, scratch) {
  const refAggregate = scratch.referenceAggregate;
  const liveAggregate = scratch.liveAggregate;
  refAggregate.fill(0);
  for (let liveIndex = 0; liveIndex < live.length; liveIndex += 1) {
    const referenceFrame = Math.round(endpoint - (live.length - 1 - liveIndex) * speed);
    const offset = referenceFrame * reference.dimensions;
    for (let pitch = 0; pitch < chromaBins; pitch += 1) {
      refAggregate[pitch] += reference.vectors[offset + pitch];
    }
  }

  let bestShift = 0;
  let bestAggregate = -Infinity;
  for (let shift = 0; shift < chromaBins; shift += 1) {
    let score = 0;
    for (let pitch = 0; pitch < chromaBins; pitch += 1) {
      score += liveAggregate[pitch] * refAggregate[(pitch + shift) % chromaBins];
    }
    if (score > bestAggregate) {
      bestAggregate = score;
      bestShift = shift;
    }
  }

  let weightedScore = 0;
  let totalWeight = 0;
  for (let liveIndex = 0; liveIndex < live.length; liveIndex += 1) {
    const referenceFrame = Math.round(endpoint - (live.length - 1 - liveIndex) * speed);
    const offset = referenceFrame * reference.dimensions;
    let chromaScore = 0;
    for (let pitch = 0; pitch < chromaBins; pitch += 1) {
      chromaScore += live[liveIndex].chroma[pitch]
        * reference.vectors[offset + ((pitch + bestShift) % chromaBins)];
    }
    let bandScore = 0;
    for (let band = 0; band < spectralBands; band += 1) {
      bandScore += live[liveIndex].bands[band] * reference.vectors[offset + chromaBins + band];
    }
    const weight = 0.7 + 0.3 * liveIndex / Math.max(1, live.length - 1);
    weightedScore += weight * (0.68 * clamp(chromaScore, 0, 1) + 0.32 * clamp((bandScore + 1) / 2, 0, 1));
    totalWeight += weight;
  }
  return {
    reference,
    endpoint,
    speed,
    bestShift,
    score: weightedScore / Math.max(1e-9, totalWeight)
  };
}

function scoreMovement(candidate, live, chromaBins) {
  const { reference, endpoint, speed, bestShift } = candidate;
  let weightedScore = 0;
  let totalWeight = 0;
  for (let liveIndex = 1; liveIndex < live.length; liveIndex += 1) {
    const referenceFrame = Math.round(endpoint - (live.length - 1 - liveIndex) * speed);
    const previousReferenceFrame = Math.round(endpoint - (live.length - liveIndex) * speed);
    const offset = referenceFrame * reference.dimensions;
    const previousOffset = previousReferenceFrame * reference.dimensions;
    let dot = 0;
    let liveNorm = 0;
    let referenceNorm = 0;
    for (let pitch = 0; pitch < chromaBins; pitch += 1) {
      const liveDelta = live[liveIndex].chroma[pitch] - live[liveIndex - 1].chroma[pitch];
      const shiftedPitch = (pitch + bestShift) % chromaBins;
      const referenceDelta = reference.vectors[offset + shiftedPitch]
        - reference.vectors[previousOffset + shiftedPitch];
      dot += liveDelta * referenceDelta;
      liveNorm += liveDelta * liveDelta;
      referenceNorm += referenceDelta * referenceDelta;
    }
    if (liveNorm <= 0.0025 || referenceNorm <= 0.0025) continue;
    const weight = 0.7 + 0.3 * liveIndex / Math.max(1, live.length - 1);
    weightedScore += weight * clamp((dot / Math.sqrt(liveNorm * referenceNorm) + 1) / 2, 0, 1);
    totalWeight += weight;
  }
  return totalWeight ? weightedScore / totalWeight : 0.5;
}

function cueForFrame(cues, frame) {
  let result = -1;
  for (let index = 0; index < cues.length; index += 1) {
    if (cues[index].frame > frame) break;
    result = index;
  }
  return result;
}

function normalizedVector(input, length) {
  if (!input || input.length !== length) return null;
  const output = new Float32Array(length);
  let norm = 0;
  for (let index = 0; index < length; index += 1) {
    const value = Number(input[index]);
    if (!Number.isFinite(value)) return null;
    output[index] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm < 1e-8) return null;
  for (let index = 0; index < length; index += 1) output[index] /= norm;
  return output;
}

function decodeBase64(value) {
  const binary = globalThis.atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function normalizeHebrew(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0591-\u05c7]/g, "")
    .replace(/[^\u05d0-\u05ea]/g, "");
}

function anchorMatches(line, anchor) {
  if (!line || !anchor) return false;
  if (safeContainment(line, anchor)) return true;
  const lineSkeleton = consonantSkeleton(line);
  const anchorSkeleton = consonantSkeleton(anchor);
  return anchorSkeleton.length >= 5 && safeContainment(lineSkeleton, anchorSkeleton);
}

function safeContainment(line, anchor) {
  if (line.includes(anchor)) return anchor.length >= 5;
  // A cue can be longer than a display line, but a tiny confession such as
  // "זדנו" must never satisfy the much later cue "בזכרי ... זדון לבי".
  const minimumLineLength = Math.max(7, Math.ceil(anchor.length * 0.5));
  return line.length >= minimumLineLength && anchor.includes(line);
}

function consonantSkeleton(value) {
  return normalizeHebrew(value)
    .replace(/[ךםןףץ]/g, (letter) => ({ ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" })[letter])
    .replace(/[וי]/g, "");
}

function emptyResult() {
  return { matched: false, stable: false, index: -1, score: 0, margin: 0, evidence: 0 };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
