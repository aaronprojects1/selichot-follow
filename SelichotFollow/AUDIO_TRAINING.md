# Selichot audio corpus and alignment plan

## What is available now

The two user-supplied source recordings and the licensed development-corpus recording remain outside the Android and web application directories and are never deployed. Web v1.5.2 packages only compact, quantized chroma and spectral-shape fingerprints plus reviewed verse cues:

| File | Duration | Format | SHA-256 | Replay finding |
| --- | ---: | --- | --- | --- |
| `audio slechot.m4a` | 47.637 s | AAC-LC, 48 kHz stereo | `e1b1957296e13a3c64da953fef2424005b0068763d7a782640cef689c5483832` | Strongly pitched, wide melodic range, only 7.48 dB level separation; offline speech VAD returned no usable segment. The garbled fallback transcript is checked for zero false jumps. |
| `PTT-20260827-WA0000.opus` | 28.113 s | Opus, 48 kHz mono | `29e5801be587e3b57ec61ed9fb8346555d8de1cd68f7e650a4a228f512612853` | Cleaner chant with 24.76 dB separation and recognizable anchors around `אל רחום`, `אל חנון`, and `ארך אפים`; replay verifies the Thirteen Attributes location. |
| `corpus/nli-adon-haselihot-ades-1982.ogg` | 96.146 s | Ogg Vorbis | `f87d4c3c5cf8fc021cd86d17adfadfbc7269b42e29cd3a36214f466471419b2e` | Ades Synagogue congregation, recorded by Chana England for the National Library of Israel (1982), licensed CC BY-SA 3.0. Twenty reviewed cues cover four stanzas and refrains of `אדון הסליחות`. |

Run the repeatable acoustic probe from the outer workspace:

```powershell
python tools\analyze_audio.py "audio slechot.m4a" "PTT-20260827-WA0000.opus"
```

This reports level, pauses, decay proxy, periodic/voiced percentage, F0 range, pitch-class movement, phrase estimates, and onset density. It does not claim verse accuracy without ground-truth timestamps.

## Variation sources found

There is no finite set of “all Selichot audio.” A useful corpus must cover the nusach/day, optional sections and repeats, melody tradition/maqam, chazzan and congregation, tempo, room reverberation, microphone/device, and arbitrary join/skip points.

Authoritative discovery sources include:

- [Sefaria's Edot HaMizrach text](https://www.sefaria.org/Selichot_Edot_HaMizrach) for canonical textual identifiers.
- The National Library of Israel's [1973 Yemenite congregational Selichot service](https://www.nli.org.il/he/items/NNL_MUSIC_AL990002563210205171/NLI), whose catalog identifies individual sections such as `בן אדם`, `אל מלך`, `אל רחום`, and `אדון הסליחות`.
- The National Library of Israel's [North African Selichot catalog recording](https://www.nli.org.il/he/items/NNL_MUSIC_AL990002544290205171/NLI), with timed section notes.
- National Library performance pages for `בן אדם מה לך נרדם` in [Jerusalem Sephardic](https://www.nli.org.il/he/piyut/Piyut1media_010029600494005171/NLI), [Libyan and other Eastern traditions](https://www.nli.org.il/he/piyut/Piyut1media_010029600463205171/NLI), and [Yemenite Sana'a](https://www.nli.org.il/he/piyut/Piyut1media_010029600060305171/NLI) styles.
- The National Library's [Turkish Sephardic survey recording](https://www.nli.org.il/he/items/NNL_MUSIC_AL990002304660205171/NLI), which explicitly catalogs multiple melodic functions/maqam examples.

Catalog access or public liturgical words do not automatically grant model-training or redistribution rights in a particular performance. Each recording needs a rights decision and written permission or an explicit compatible license. Only the explicitly CC BY-SA Ades recording was incorporated; other discovered recordings with missing or incompatible reuse terms were not downloaded into the corpus.

## Required annotation contract

Each permissioned recording should have a sidecar with stable text IDs and timestamps at least every 2–5 seconds:

```json
{
  "recording_id": "community-date-service",
  "rights": "permission or license reference",
  "tradition": "Edot HaMizrach / community and melody family",
  "device_room": "phone model, distance, room notes",
  "anchors": [
    {"start_ms": 0, "end_ms": 4200, "prayer_id": "canonical-section-and-line"}
  ]
}
```

Split evaluation by chazzan and room—not random snippets from the same recording. Track cold-lock time, line accuracy within ±1, median/P95 highlight lag, false jumps per minute, skip/repeat recovery, and coverage.

## Reference-model phase

Web v1.5.2 implements the production reference path for the two supplied files and licensed Ades performance: 140 ms feature frames, key-normalized chroma, log spectral-shape bands, sliding family-aware retrieval across 72%–135% tempo, global pitch-shift tolerance, stable multi-frame consensus, and exact prayer-line cue mapping. The browser test harness feeds all three recordings into Chrome as a simulated microphone; unrelated synthetic features and sustained-tone phrases are required to produce no stable match.

The production-safe next stage is a causal hybrid follower:

1. Extract key-normalized pitch contour/chroma and onset envelopes every 10–20 ms from licensed, annotated references.
2. Retrieve global candidates from 2–4 seconds of live features.
3. Track a small beam with bounded online subsequence dynamic time warping, including explicit skip, repeat, and refrain states.
4. Fuse acoustic continuity with constrained Hebrew phonetic/text evidence; repeated melody never overrides a distinctive word margin.
5. Package compact, non-reconstructive feature references when the recording license does not permit distributing source audio.

For unregistered melodies, v1.5.2 relies on Hebrew word recognition to establish position; a detected phrase boundary can corroborate those words but cannot advance the page alone. This deliberately prevents the jumping seen when pauses were treated as verse progress. Adding broad congregational coverage still requires the permissioned, annotated corpus described above.
