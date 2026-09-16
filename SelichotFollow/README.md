# Selichot Follow · סליחות

Version 2.1 is a bilingual Android and web companion for following Sephardic / Edot HaMizrach Selichot in a live service.

## Installable web app

The `web/` directory contains the shared, installable Selichot experience for browsers, Android, and iPhone. It is a dependency-free Progressive Web App with:

- A responsive navy-and-gold reading experience for phone, tablet, and desktop.
- Live Hebrew browser speech recognition with global re-acquisition, repeated-refrain ambiguity checks, and the same position-aware matching rules as Android.
- A measured microphone waveform plus local activity, pitch-class/melody-change, and chant-boundary analysis. Audio is processed in memory and is never uploaded or saved by the PWA.
- Automatic bilingual Edot HaMizrach text retrieval from Sefaria, local progress and nusach persistence, and a 17-line offline fallback.
- PWA installation guidance tailored to Android and iPhone, plus an offline application shell after the first visit.
- An editable Hebrew nusach for communities whose exact service differs.

## Web v1.6.0 recognition recovery

- Recovers silent recognizer stalls, including missing start/end events, with a 12-second watchdog and bounded retry backoff.
- Retries microphone capture conflicts with Web Audio released so the word service can own the microphone.
- Disables unsupported contextual phrase hints and retries; permission and unsupported-language errors show an explicit Retry control.
- Stops retired recognizer callbacks and pending microphone requests from reviving a stopped session.
- Bundles the full 1,422-phrase service and caches it offline; preserves the selected phrase while replacing starter text.
- Reports recognition failures separately from microphone activity. Recognition still depends on the browser's Hebrew speech service; recording fingerprints cover only the supplied references.

Validation: `node --test web/tests/*.test.mjs`; with a local HTTP server on port 8765, `python ../tools/browser_tracking_test.py` tests real UI movement with controlled recognition events, recovery, mobile overflow, and full offline text. `python ../tools/browser_recording_test.py` replays supplied audio through Chrome's microphone/Web Audio pipeline. These do not certify live transcription in every room or on every phone.

## Web v1.5.2 live-audio reliability update

- Adds a fast local melody-and-spectral fingerprint matcher for the two supplied recordings plus a licensed 1982 Ades Synagogue congregational performance from the National Library of Israel. It identifies those performances without waiting for browser speech recognition and follows their annotated verses continuously.
- Groups alternate performances into melody families, searches from 72%–135% of reference tempo, and fast-locks distinctive passages after two strong confirmations.
- Removes blind pause/rhythm advancement. A pause can confirm matching words, but it can no longer move the highlight by itself and make the page appear to follow when recognition has actually failed.
- Corrects full-service cue alignment, including optional Hebrew vowel-letter spellings and protection against tiny earlier phrases stealing a later cue. All 37 reviewed timestamps now map to the intended full-service lines.
- Keeps Web Audio melody matching alive if Android's browser word service reports `no-speech`, `audio-capture`, or a service error, and shares the already-authorized microphone track where the browser supports it.
- Uses short recognition sessions on Android, global phrase hints, lower-latency voice activity thresholds, automatic microphone-stream recovery, and visible runtime diagnostics for microphone/reference state.
- Updates only changed prayer cards and skips off-screen painting, avoiding a 1,422-card restyle on every verse advance on phones.
- Treats audible chant separately from speech-to-text, so a browser `no-speech` result no longer reports that the microphone heard nothing or clears a valid melody lock.
- Disables speech-oriented echo/noise suppression that could erase sustained singing, shortens acoustic smoothing, and keeps microphone analysis entirely in the browser.
- Requires multiple independent text observations before any far-away transcript jump. Reference-audio movement requires a stable multi-frame match and rejects unrelated synthetic audio and sustained tones in replay tests.
- Versions the reference-data URL so service-worker caching cannot leave phones on an older matcher after deployment.
- Deploys only compact, quantized, non-reversible chroma and spectral-shape features—not source recordings.

Firebase Hosting is configured at the project root and targets the `selichot-web` Firebase project:

```powershell
firebase serve --only hosting
firebase deploy --only hosting
```

The PWA is the shared product surface. If App Store or Play Store distribution is needed later, it can be wrapped with Capacitor while continuing to use the same `web/` codebase. Browser speech recognition support varies by platform; manual following always remains available.

## What changed in v2.1

- Searches the entire service when the saved/local position does not fit, allowing a distinctive phrase to re-lock from anywhere instead of remaining trapped in a fixed search window.
- Compares the best and runner-up regions before long jumps, favors the narrowest exact verse, requires fresh evidence for backward recovery, and prevents identical interim callbacks from pretending to be multiple confirmations.
- Uses real Web Audio levels, pitch-class movement, and chant phrase boundaries to confirm textual evidence. Melody or rhythm alone never selects a verse because repeated tunes are ambiguous without labeled reference recordings.
- Reduced Android recognition windows from 6–9 seconds to 1.4–1.8 seconds and silence windows from 1.4–2.4 seconds to 0.3–0.65 seconds, while retaining provider-safe retry behavior.
- Runs live Android text alignment on a dedicated matcher thread and drops superseded interim work so global comparison cannot stall the reading interface.
- Verifies Android speech-service file support before streaming a selected recording, rather than risking a provider silently listening to the microphone instead.
- Expanded replay coverage for both supplied recordings and added pitch, phrase, onset, level, and reverberation diagnostics.

## Earlier v2 foundation

- Replaced the corrupted Hebrew source with real UTF-8 Hebrew and English translations.
- Rebuilt the interface as a dark navy-and-gold bilingual reading experience with large prayer cards, progress, audio level, manual previous/next recovery, and Hebrew/English display modes.
- Replaced single-result fuzzy matching with a stateful Hebrew tracker that uses rolling speech context, recognizer confidence, weighted words, character similarity, Hebrew phonetic families, position bias, and confirmation before uncertain long jumps.
- Added room profiles for balanced sound, reverberant rooms, and difficult-hearing conditions. The profiles change matching thresholds, search distance, silence timing, and jump confirmation.
- Added live ambient-level estimation so crowd noise raises the evidence needed for an automatic jump.
- Added an Android 13+ troubleshooting tool that can temporarily analyze a user-selected audio/video file. No development recording is bundled or retained by the app.
- Added development-only acoustic diagnostics for the supplied recordings. No source recording is packaged in the APK or deployed with the PWA.
- Downloads aligned Hebrew and English Selichot segments from Sefaria, while still allowing a custom synagogue nusach.
- Added speech-service package visibility required by modern Android versions, richer error recovery, prayer-context biasing, a new adaptive icon, matcher tests, and a clean Android lint run.

## Use

1. Install `SelichotFollow.apk` and grant microphone permission.
2. Tap **LISTEN / האזן** during the service.
3. Tap the room-profile chip to switch between balanced, echo-room, and hard-to-hear modes.
4. Tap **HE · EN** to cycle bilingual, Hebrew-only, and English-only display.
5. Use the arrows or tap any prayer card whenever manual correction is needed.
6. Open the top-right menu to edit the synagogue's exact Hebrew nusach, troubleshoot with a recording, or open Android's speech-service settings. Recording analysis requires Android 13+ and a speech service that supports Android's audio-source API.
7. On first launch the app automatically retrieves the full bilingual Sephardic text; the starter text remains available if the phone is offline.

## Build and verification

Open this folder in Android Studio and choose **Build > Build APK(s)**, or run:

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug verifyNoDevelopmentMedia
node --test web\tests\*.test.mjs
python ..\tools\analyze_audio.py "..\audio slechot.m4a" "..\PTT-20260827-WA0000.opus"
```

The generated APK is `app/build/outputs/apk/debug/app-debug.apk`.

The checked-in v2.1 APK was built with Android Gradle Plugin 8.7.3, Gradle 8.9, JDK 17, compile SDK 35, minimum SDK 26, and target SDK 35. Verification includes JVM matcher tests, browser-core tests, Android lint, APK metadata inspection, and an APK-content check confirming that development recordings are absent.

## Audio expectations

Android's `SpeechRecognizer` still depends on the recognition service installed on the phone. The app can make tracking much more stable after imperfect transcription, but software matching cannot physically remove long room reverberation from the chazzan's voice. Keep the phone unobstructed and reasonably close to the sound source, select the closest room profile, and install/download Hebrew recognition support in Android's voice-input settings when available.

The supplied files total only 75.75 seconds. Web v1.5.2 adds a 96-second licensed congregational `Adon HaSelichot` reference, manually reviewed verse cues, and non-reversible acoustic fingerprints, but these are not a sufficient corpus for every congregation or melody. Broader coverage still needs permissioned recordings from multiple traditions, verse-level timestamps, and held-out chazzan/room/device tests. See `AUDIO_TRAINING.md`.
