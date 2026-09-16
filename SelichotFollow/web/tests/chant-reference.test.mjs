import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ChantReferenceMatcher } from "../chant-reference.mjs";

const payload = JSON.parse(await readFile(new URL("../audio-references.json", import.meta.url), "utf8"));

function decodeFrames(reference) {
  const bytes = Uint8Array.from(Buffer.from(reference.features, "base64"));
  const dimensions = payload.chromaBins + payload.spectralBands;
  return Array.from({ length: reference.frames }, (_, frame) => {
    const offset = frame * dimensions;
    return {
      chroma: Array.from(bytes.slice(offset, offset + payload.chromaBins), (value) => value / 255),
      bands: Array.from(bytes.slice(offset + payload.chromaBins, offset + dimensions), (value) => value / 127.5 - 1)
    };
  });
}

function mappedLines() {
  const output = [];
  for (const reference of payload.references) {
    for (const cue of reference.cues) {
      output.push({ he: cue.anchor });
      output.push({ he: `מילת מעבר ${output.length}` });
    }
  }
  return output;
}

test("supplied M4A fingerprint globally locks from the middle of the recording", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  const source = payload.references.find((reference) => reference.id.includes("m4a"));
  const frames = decodeFrames(source);
  let result;
  for (const frame of frames.slice(220, 244)) result = matcher.observe(frame.chroma, frame.bands);
  assert.equal(result.stable, true);
  assert.match(result.referenceId, /m4a/);
  assert.ok(result.score > 0.9);
  assert.ok(result.index >= 0);
});

test("global pitch transposition still identifies the supplied melody", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  const source = payload.references.find((reference) => reference.id.includes("opus"));
  const frames = decodeFrames(source);
  let result;
  for (const frame of frames.slice(80, 104)) {
    const shifted = frame.chroma.map((_, index) => frame.chroma[(index + 3) % frame.chroma.length]);
    result = matcher.observe(shifted, frame.bands);
  }
  assert.equal(result.stable, true);
  assert.match(result.referenceId, /opus/);
});

test("the supplied Opus recording cold-starts within a few seconds", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  const source = payload.references.find((reference) => reference.id.includes("opus"));
  const frames = decodeFrames(source);
  let result;
  let firstStable;
  for (const frame of frames.slice(0, 24)) {
    result = matcher.observe(frame.chroma, frame.bands);
    if (!firstStable && result.stable) firstStable = result;
  }
  assert.ok(firstStable);
  result = firstStable;
  assert.match(result.referenceId, /opus/);
  assert.ok(result.index >= 0);
});

test("the user-provided phone-to-phone capture locks to its reviewed Bizochri cues", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  const source = payload.references.find((reference) => reference.id.includes("phone-to-phone"));
  assert.ok(source);
  const frames = decodeFrames(source);
  let firstStable;
  for (const frame of frames.slice(35, 63)) {
    const result = matcher.observe(frame.chroma, frame.bands);
    if (!firstStable && result.stable) firstStable = result;
  }
  assert.ok(firstStable);
  assert.equal(firstStable.referenceId, source.id);
  assert.ok(firstStable.index >= 0);
});

test("unrelated noise never creates a stable verse match", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  let result;
  for (let frame = 0; frame < 60; frame += 1) {
    const chroma = Array.from({ length: payload.chromaBins }, (_, index) => ((frame * 17 + index * 11) % 31) / 31);
    const bands = Array.from({ length: payload.spectralBands }, (_, index) => Math.sin(frame * 1.7 + index * 2.3));
    result = matcher.observe(chroma, bands);
    assert.equal(result.stable, false);
  }
});

test("sustained tones cannot masquerade as a known congregational melody", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  for (let frame = 0; frame < 80; frame += 1) {
    const pitch = Math.floor(frame / 24) % payload.chromaBins;
    const chroma = Array.from({ length: payload.chromaBins }, (_, index) => index === pitch ? 1 : 0);
    const bands = Array.from({ length: payload.spectralBands }, (_, index) => index === 2 + pitch ? 1 : -0.03);
    const result = matcher.observe(chroma, bands);
    assert.equal(result.stable, false);
  }
});

test("fingerprints cannot move when their verse anchors are absent", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines([{ he: "טקסט אחר שאינו תואם" }]);
  const frames = decodeFrames(payload.references[0]);
  let result;
  for (const frame of frames.slice(40, 70)) result = matcher.observe(frame.chroma, frame.bands);
  assert.equal(result.stable, false);
  assert.equal(result.index, -1);
});

test("a locked performance does not oscillate back to an earlier cue", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  const source = payload.references.find((reference) => reference.id.includes("m4a"));
  const frames = decodeFrames(source);
  let locked;
  for (const frame of frames.slice(55, 82)) locked = matcher.observe(frame.chroma, frame.bands);
  assert.equal(locked.stable, true);
  const lockedIndex = locked.index;

  for (const frame of frames.slice(0, 35)) {
    const result = matcher.observe(frame.chroma, frame.bands);
    if (result.stable && result.referenceId === locked.referenceId) {
      assert.ok(result.index >= lockedIndex);
    }
  }
});

test("the licensed congregational reference locks at a 35 percent faster tempo", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines(mappedLines());
  const source = payload.references.find((reference) => reference.id.startsWith("nli-"));
  const frames = decodeFrames(source);
  let result;
  for (let index = 0; index < 24; index += 1) {
    result = matcher.observe(...Object.values(frames[Math.round(330 + index * 1.35)]));
  }
  assert.equal(result.stable, true);
  assert.equal(result.referenceId, source.id);
  assert.ok(result.index >= 0);
});

test("the licensed reference carries deployable attribution metadata", () => {
  const source = payload.references.find((reference) => reference.id.startsWith("nli-"));
  assert.equal(source.license, "CC BY-SA 3.0");
  assert.match(source.sourceUrl, /commons\.wikimedia\.org/);
  assert.match(source.attribution, /National Library of Israel/);
});

test("cue mapping tolerates optional vav and yod spelling variants", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines([
    { he: "שומע תפלות" },
    { he: "כובש עונות" },
    { he: "מלא זכיות" },
    { he: "נורא תהלות" },
    { he: "סולח עונות" }
  ]);

  const opus = matcher.references.find((reference) => reference.id.includes("opus"));
  const licensed = matcher.references.find((reference) => reference.id.startsWith("nli-"));
  assert.equal(opus.cues[0].lineIndex, 0);
  assert.equal(licensed.cues[12].lineIndex, 1);
  assert.equal(licensed.cues[15].lineIndex, 2);
  assert.equal(licensed.cues[16].lineIndex, 3);
  assert.equal(licensed.cues[17].lineIndex, 4);
});

test("a short earlier confession cannot steal a later piyut cue", () => {
  const matcher = new ChantReferenceMatcher();
  matcher.load(payload);
  matcher.setLines([
    { he: "זדנו" },
    { he: "יש נוהגים לומר בזכרי על משכבי זדון לבי ואשמיו" },
    { he: "ואמר בנשאי עין בתחנוני אלי שמיו" },
    { he: "נפלה נא ביד יהוה כי רבים רחמיו" },
    { he: "לך אלי צור חילי מנוסתי בצרתי" },
    { he: "בך שברי ותקותי אילותי בגלותי" },
    { he: "לך כל משאלות לבי ונגדך כל תאותי" },
    { he: "פדה עבד לך צועק מיד רודיו וקמיו" },
    { he: "ענני יהוה ענני בקראי מן המצר" }
  ]);

  const supplied = matcher.references.find((reference) => reference.id.includes("m4a"));
  assert.equal(supplied.cues[0].lineIndex, 1);
  assert.deepEqual(supplied.cues.map((cue) => cue.lineIndex), [1, 2, 3, 4, 5, 6, 7, 8]);
});
