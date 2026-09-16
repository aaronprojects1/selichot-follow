import test from "node:test";
import assert from "node:assert/strict";

import { RhythmContinuityFollower } from "../rhythm-continuity.mjs";

test("an audible phrase advances one line from an explicit anchor", () => {
  const follower = new RhythmContinuityFollower();
  follower.anchor(42, 1000);
  const result = follower.observe({
    boundaryId: 5000,
    now: 5000,
    currentIndex: 42,
    total: 100,
    recentSpeech: true,
    phraseDuration: 3500
  });
  assert.deepEqual(result, { moved: true, index: 43, mode: "rhythm" });
});

test("rhythm never guesses a global position without an anchor", () => {
  const follower = new RhythmContinuityFollower();
  const result = follower.observe({
    boundaryId: 5000,
    now: 5000,
    currentIndex: 42,
    total: 100,
    recentSpeech: true,
    phraseDuration: 3500
  });
  assert.equal(result.moved, false);
});

test("one phrase boundary can only be consumed once", () => {
  const follower = new RhythmContinuityFollower();
  follower.anchor(10, 1000);
  const input = {
    boundaryId: 5000,
    now: 5000,
    currentIndex: 10,
    total: 100,
    recentSpeech: true,
    phraseDuration: 3500
  };
  assert.equal(follower.observe(input).moved, true);
  assert.equal(follower.observe({ ...input, currentIndex: 11, now: 5100 }).moved, false);
});

test("recent words or a reference remain authoritative over rhythm", () => {
  const follower = new RhythmContinuityFollower();
  follower.anchor(10, 1000);
  const result = follower.observe({
    boundaryId: 5000,
    now: 5000,
    currentIndex: 10,
    total: 100,
    recentSpeech: true,
    phraseDuration: 3500,
    authoritativeAt: 4400
  });
  assert.equal(result.moved, false);
});

test("noise pops and very long ambient sound do not advance", () => {
  const follower = new RhythmContinuityFollower();
  follower.anchor(10, 1000);
  assert.equal(follower.observe({
    boundaryId: 1500,
    now: 1500,
    currentIndex: 10,
    total: 100,
    recentSpeech: true,
    phraseDuration: 300
  }).moved, false);
  assert.equal(follower.observe({
    boundaryId: 25000,
    now: 25000,
    currentIndex: 10,
    total: 100,
    recentSpeech: true,
    phraseDuration: 22000
  }).moved, false);
});
