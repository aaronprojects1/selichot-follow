const DEFAULTS = {
  minimumPhraseMs: 700,
  maximumPhraseMs: 20000,
  minimumAdvanceGapMs: 850,
  anchorLifetimeMs: 90000,
  authorityQuietMs: 1800
};

/**
 * Keeps following locally when a browser's word service cannot transcribe song.
 * Rhythm can advance from a known place, but it is deliberately never used to
 * choose a place globally: melody fingerprints and recognized words do that.
 */
export class RhythmContinuityFollower {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.reset();
  }

  reset() {
    this.anchorIndex = -1;
    this.anchorAt = 0;
    this.lastAdvanceAt = 0;
    this.lastBoundaryId = 0;
  }

  anchor(index, now = Date.now()) {
    if (!Number.isInteger(index) || index < 0) return;
    this.anchorIndex = index;
    this.anchorAt = now;
  }

  observe({
    boundaryId,
    now = Date.now(),
    currentIndex,
    total,
    recentSpeech,
    phraseDuration,
    authoritativeAt = 0
  }) {
    if (!boundaryId || boundaryId === this.lastBoundaryId) return idle(currentIndex);
    this.lastBoundaryId = boundaryId;

    const anchored = this.anchorIndex === currentIndex
      && now - this.anchorAt <= this.options.anchorLifetimeMs;
    const phraseIsPlausible = phraseDuration >= this.options.minimumPhraseMs
      && phraseDuration <= this.options.maximumPhraseMs;
    const authorityIsQuiet = !authoritativeAt
      || now - authoritativeAt >= this.options.authorityQuietMs;
    const cooledDown = !this.lastAdvanceAt
      || now - this.lastAdvanceAt >= this.options.minimumAdvanceGapMs;

    if (!anchored || !recentSpeech || !phraseIsPlausible || !authorityIsQuiet || !cooledDown) {
      return idle(currentIndex);
    }
    if (!Number.isInteger(total) || currentIndex >= total - 1) return idle(currentIndex);

    const index = currentIndex + 1;
    this.anchorIndex = index;
    this.anchorAt = now;
    this.lastAdvanceAt = now;
    return { moved: true, index, mode: "rhythm" };
  }
}

function idle(index) {
  return { moved: false, index, mode: "rhythm" };
}
