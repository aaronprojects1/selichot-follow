import { SpeechSession } from "./speech-session.mjs?v=1.6.1";
import { PrayerTracker, normalizeHebrew } from "./tracking-core.mjs?v=1.6.1";
import { ChantReferenceMatcher } from "./chant-reference.mjs?v=1.6.1";

const STARTER_LINES = [
  { he: "בן אדם מה לך נרדם, קום קרא בתחנונים", en: "Child of humanity, why do you sleep? Rise and call out with supplications." },
  { he: "שפוך שיחה, דרוש סליחה, מאדון האדונים", en: "Pour out your words; seek forgiveness from the Master of masters." },
  { he: "רחץ וטהר ואל תאחר, בטרם ימים פונים", en: "Wash and purify yourself; do not delay before the days turn away." },
  { he: "ומהרה רוץ לעזרה, לפני שוכן מעונים", en: "Hurry and run for help before the One who dwells on high." },
  { he: "ומפשע וגם רשע, ברח ופחד מאסונים", en: "Flee transgression and wrongdoing, and fear their consequences." },
  { he: "אנא שעה שמך יודעי, ישראל נאמנים", en: "Please turn toward those who know Your name—faithful Israel." },
  { he: "לך אדני הצדקה, ולנו בושת הפנים", en: "Righteousness is Yours, Lord; shame is ours." },
  { he: "אל מלך יושב על כסא רחמים", en: "God and King, seated upon the throne of mercy." },
  { he: "מתנהג בחסידות, מוחל עוונות עמו", en: "Acting with lovingkindness, forgiving the sins of His people." },
  { he: "מעביר ראשון ראשון, מרבה מחילה לחטאים", en: "Removing each sin in turn, abundant in forgiveness for sinners." },
  { he: "וסליחה לפושעים, עושה צדקות עם כל בשר ורוח", en: "Granting pardon to transgressors, doing righteousness with every living being." },
  { he: "לא כרעתם גומל להם", en: "Not repaying them according to their wrongdoing." },
  { he: "אל הורית לנו לומר שלש עשרה", en: "God, You taught us to recite the Thirteen Attributes." },
  { he: "זכור לנו היום ברית שלש עשרה", en: "Remember for us today the covenant of the Thirteen Attributes." },
  { he: "ויעבור ה׳ על פניו ויקרא", en: "The Lord passed before him and proclaimed." },
  { he: "ה׳ ה׳ אל רחום וחנון, ארך אפים ורב חסד ואמת", en: "The Lord, the Lord—compassionate and gracious, slow to anger, abundant in kindness and truth." },
  { he: "נוצר חסד לאלפים, נושא עון ופשע וחטאה ונקה", en: "Preserving kindness for thousands, forgiving iniquity, transgression, and sin, and cleansing." }
];

const SEFARIA_URL = "https://www.sefaria.org/api/texts/Selichot_Edot_HaMizrach?pad=0&commentary=0";
const STORAGE_KEY = "selichot-follow-web-v1";
const DISPLAY_ORDER = ["both", "hebrew", "english"];
const PROFILE_ORDER = ["balanced", "echo", "hard"];
const PROFILE_META = {
  balanced: { label: "Balanced", short: "Balanced", status: "Quiet or close listening" },
  echo: { label: "Echo room", short: "Echo", status: "Tuned for a reverberant room" },
  hard: { label: "Hard to hear", short: "Forgiving", status: "More forgiving voice matching" }
};

const elements = {
  prayerList: document.querySelector("#prayer-list"),
  readerScroll: document.querySelector("#reader-scroll"),
  currentCount: document.querySelector("#current-count"),
  totalCount: document.querySelector("#total-count"),
  progressBar: document.querySelector("#progress-bar"),
  sectionOptions: document.querySelector("#section-options"),
  journeyPercent: document.querySelector("#journey-percent"),
  journeyRing: document.querySelector("#journey-ring"),
  journeyNumber: document.querySelector("#journey-number"),
  journeyTotal: document.querySelector("#journey-total"),
  journeyMode: document.querySelector("#journey-mode"),
  journeyRoom: document.querySelector("#journey-room"),
  displayModeButton: document.querySelector("#display-mode-button"),
  profileButton: document.querySelector("#profile-button"),
  profileLabel: document.querySelector("#profile-label"),
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  firstButton: document.querySelector("#first-button"),
  lastButton: document.querySelector("#last-button"),
  listenButton: document.querySelector("#listen-button"),
  listenButtonStrong: document.querySelector("#listen-button strong"),
  listenButtonSmall: document.querySelector("#listen-button small"),
  statusDot: document.querySelector("#status-dot"),
  statusText: document.querySelector("#status-text"),
  statusSubtext: document.querySelector("#status-subtext"),
  heardText: document.querySelector("#heard-text"),
  waveform: document.querySelector("#waveform"),
  waveBars: [...document.querySelectorAll("#waveform i")],
  jumpCurrent: document.querySelector("#jump-current"),
  serviceEnd: document.querySelector("#service-end"),
  beginAgain: document.querySelector("#begin-again"),
  settingsButton: document.querySelector("#settings-button"),
  settingsDialog: document.querySelector("#settings-dialog"),
  installDialog: document.querySelector("#install-dialog"),
  editDialog: document.querySelector("#edit-dialog"),
  nativeInstall: document.querySelector("#native-install"),
  installInstructions: document.querySelector("#install-instructions"),
  displayOptions: [...document.querySelectorAll("[data-display]")],
  profileOptions: [...document.querySelectorAll("[data-profile]")],
  fontSize: document.querySelector("#font-size"),
  textSource: document.querySelector("#text-source"),
  downloadText: document.querySelector("#download-text"),
  editText: document.querySelector("#edit-text"),
  restoreText: document.querySelector("#restore-text"),
  resetProgress: document.querySelector("#reset-progress"),
  prayerEditor: document.querySelector("#prayer-editor"),
  saveText: document.querySelector("#save-text"),
  onlineState: document.querySelector("#online-state"),
  retryListener: document.querySelector("#retry-listener"),
  toast: document.querySelector("#toast")
};

const defaults = {
  currentIndex: 0,
  display: "both",
  profile: "echo",
  fontSize: 27,
  source: "starter",
  prayers: STARTER_LINES
};

let state = loadState();
let cards = [];
let renderedCurrentIndex = -1;
let deferredInstallPrompt = null;
let toastTimer = 0;
let recognition = null;
let listeningGeneration = 0;
let shouldListen = false;
let wakeLock = null;
let recognitionResultCount = 0;
let lastRecognitionAt = 0;
let lastAcousticMatchAt = 0;
let lastReferenceMoveAt = 0;
let chantReferencesPromise = null;
let chantReferencesReady = false;
let chantReferenceCount = 0;
let chantReferenceError = "";
let acousticRecoveryTimer = 0;
let acousticRecovering = false;
const acousticSession = {
  stream: null,
  context: null,
  source: null,
  analyser: null,
  frameRequest: 0,
  timeData: null,
  frequencyData: null,
  lastFrameAt: 0,
  noiseFloor: 0.0015,
  peakLevel: 0.01,
  active: false,
  activeSince: 0,
  quietSince: 0,
  lastActiveAt: 0,
  boundaryAt: 0,
  lastPhraseDuration: 0,
  lastChroma: null,
  melodyMovement: 0,
  lastReferenceFrameAt: 0,
  rms: 0,
  enterThreshold: 0,
  exitThreshold: 0
};

const tracker = new PrayerTracker();
const chantMatcher = new ChantReferenceMatcher();
tracker.setLines(state.prayers);
chantMatcher.setLines(state.prayers);
tracker.setCurrentIndex(state.currentIndex);
tracker.setProfile(state.profile);

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const prayers = Array.isArray(stored?.prayers) && stored.prayers.length ? stored.prayers.filter(validPrayer) : STARTER_LINES;
    return {
      currentIndex: clamp(Number(stored?.currentIndex) || 0, 0, Math.max(0, prayers.length - 1)),
      display: DISPLAY_ORDER.includes(stored?.display) ? stored.display : defaults.display,
      profile: PROFILE_ORDER.includes(stored?.profile) ? stored.profile : defaults.profile,
      fontSize: clamp(Number(stored?.fontSize) || defaults.fontSize, 20, 36),
      source: ["starter", "sefaria", "custom"].includes(stored?.source) ? stored.source : "starter",
      prayers
    };
  } catch {
    return { ...defaults, prayers: [...STARTER_LINES] };
  }
}

function validPrayer(line) {
  return line && typeof line.he === "string" && line.he.trim();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    showToast("Your browser could not save this change. Private browsing may limit storage.");
  }
}

function renderPrayers({ scroll = false } = {}) {
  const fragment = document.createDocumentFragment();
  elements.prayerList.replaceChildren();
  cards = state.prayers.map((line, index) => {
    const card = document.createElement("article");
    card.className = "prayer-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.dataset.index = String(index);

    const number = document.createElement("span");
    number.className = "prayer-card__number";
    number.textContent = pad(index + 1);

    const hebrew = document.createElement("p");
    hebrew.className = "prayer-card__hebrew";
    hebrew.lang = "he";
    hebrew.dir = "rtl";
    hebrew.textContent = line.he;

    const english = document.createElement("p");
    english.className = "prayer-card__english";
    english.lang = "en";
    english.textContent = line.en?.trim() || "Translation unavailable for this custom phrase.";

    card.append(number, hebrew, english);
    card.addEventListener("click", () => setCurrentIndex(index, { scroll: false, manual: true }));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setCurrentIndex(index, { scroll: false, manual: true });
      }
    });
    fragment.append(card);
    return card;
  });
  elements.prayerList.append(fragment);
  renderedCurrentIndex = -1;
  renderSectionOptions();
  updateInterface({ scroll });
}

function renderSectionOptions() {
  const anchors = state.prayers
    .map((line, index) => ({ label: line.title, index }))
    .filter((anchor, index, all) => anchor.label && all.findIndex((candidate) => candidate.label === anchor.label) === index);
  const sections = anchors.length >= 2 ? anchors : [
    { label: "התחלה", index: 0 },
    { label: "סוף", index: Math.max(0, state.prayers.length - 1) }
  ];
  elements.sectionOptions.replaceChildren();
  sections.forEach((section) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = section.label;
    button.title = `Jump to ${section.label}`;
    button.dataset.index = String(section.index);
    elements.sectionOptions.append(button);
  });
}

function updateInterface({ scroll = false, immediate = false } = {}) {
  const total = Math.max(1, state.prayers.length);
  state.currentIndex = clamp(state.currentIndex, 0, total - 1);
  const progress = ((state.currentIndex + 1) / total) * 100;

  updateCardStates(state.currentIndex);

  elements.currentCount.textContent = pad(state.currentIndex + 1);
  elements.totalCount.textContent = pad(total);
  elements.progressBar.style.width = `${progress}%`;
  elements.journeyPercent.textContent = `${Math.round(progress)}%`;
  elements.journeyRing.style.setProperty("--progress", progress.toFixed(2));
  elements.journeyNumber.textContent = pad(state.currentIndex + 1);
  elements.journeyTotal.textContent = String(total);
  elements.journeyMode.textContent = state.display === "both" ? "Bilingual" : state.display === "hebrew" ? "Hebrew" : "English";
  elements.journeyRoom.textContent = PROFILE_META[state.profile].short;
  elements.profileLabel.textContent = PROFILE_META[state.profile].label;
  elements.previousButton.disabled = state.currentIndex === 0;
  elements.nextButton.disabled = state.currentIndex >= total - 1;
  elements.serviceEnd.classList.toggle("is-visible", state.currentIndex >= total - 1);

  document.body.dataset.display = state.display;
  document.documentElement.style.setProperty("--hebrew-size", `${state.fontSize}px`);
  elements.fontSize.value = String(state.fontSize);
  elements.displayModeButton.classList.toggle("is-hebrew", state.display === "hebrew");
  elements.displayModeButton.classList.toggle("is-english", state.display === "english");
  elements.displayOptions.forEach((button) => button.classList.toggle("is-active", button.dataset.display === state.display));
  elements.profileOptions.forEach((button) => button.classList.toggle("is-active", button.dataset.profile === state.profile));
  elements.textSource.textContent = `${state.source === "sefaria" ? "Full Sephardic service" : state.source === "custom" ? "Custom nusach" : "Starter service"} · ${state.prayers.length} phrases`;

  if (scroll) scrollToCurrent({ immediate });
}

function updateCardStates(nextIndex) {
  if (renderedCurrentIndex < 0) {
    cards.forEach((card, index) => {
      card.classList.toggle("is-current", index === nextIndex);
      card.classList.toggle("is-passed", index < nextIndex);
      if (index === nextIndex) card.setAttribute("aria-current", "step");
      else card.removeAttribute("aria-current");
    });
    renderedCurrentIndex = nextIndex;
    return;
  }
  if (renderedCurrentIndex === nextIndex) return;

  const previousCard = cards[renderedCurrentIndex];
  previousCard?.classList.remove("is-current");
  previousCard?.removeAttribute("aria-current");
  if (nextIndex > renderedCurrentIndex) {
    for (let index = renderedCurrentIndex; index < nextIndex; index += 1) {
      cards[index]?.classList.add("is-passed");
    }
  } else {
    for (let index = nextIndex; index <= renderedCurrentIndex; index += 1) {
      cards[index]?.classList.remove("is-passed");
    }
  }
  const currentCard = cards[nextIndex];
  currentCard?.classList.remove("is-passed");
  currentCard?.classList.add("is-current");
  currentCard?.setAttribute("aria-current", "step");
  renderedCurrentIndex = nextIndex;
}

function setCurrentIndex(index, { scroll = true, manual = false } = {}) {
  state.currentIndex = clamp(index, 0, Math.max(0, state.prayers.length - 1));
  tracker.setCurrentIndex(state.currentIndex);
  if (manual) tracker.clearContext();
  saveState();
  updateInterface({ scroll });
}

function moveCurrent(delta) {
  setCurrentIndex(state.currentIndex + delta, { scroll: true, manual: true });
}

function jumpToBoundary(index) {
  setCurrentIndex(index, { scroll: true, manual: true });
}

function scrollToCurrent({ immediate = false } = {}) {
  const card = cards[state.currentIndex];
  if (!card) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollBounds = elements.readerScroll.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const targetTop = elements.readerScroll.scrollTop
    + cardBounds.top
    - scrollBounds.top
    - (scrollBounds.height - cardBounds.height) / 2;
  elements.readerScroll.scrollTo({
    top: Math.max(0, targetTop),
    behavior: immediate || reducedMotion ? "auto" : "smooth"
  });
}

function settleCurrentScroll() {
  // content-visibility gives off-screen cards an estimated height. Recenter
  // after two layout passes so a deep saved position remains visible once the
  // browser has replaced those estimates with real mobile line wrapping.
  requestAnimationFrame(() => {
    scrollToCurrent({ immediate: true });
    requestAnimationFrame(() => scrollToCurrent({ immediate: true }));
  });
  window.setTimeout(() => scrollToCurrent({ immediate: true }), 220);
}

function keepCurrentVisible() {
  const card = cards[state.currentIndex];
  if (!card) return;
  const scrollBounds = elements.readerScroll.getBoundingClientRect();
  const cardBounds = card.getBoundingClientRect();
  const controlsHeight = document.querySelector(".player-controls")?.offsetHeight || 0;
  const topLimit = scrollBounds.top + 12;
  const bottomLimit = scrollBounds.bottom - controlsHeight - 18;
  if (cardBounds.top < topLimit || cardBounds.bottom > bottomLimit) scrollToCurrent({ immediate: true });
}

function cycleDisplay() {
  const nextIndex = (DISPLAY_ORDER.indexOf(state.display) + 1) % DISPLAY_ORDER.length;
  setDisplay(DISPLAY_ORDER[nextIndex]);
}

function setDisplay(display) {
  if (!DISPLAY_ORDER.includes(display)) return;
  state.display = display;
  saveState();
  updateInterface();
}

function cycleProfile() {
  const nextIndex = (PROFILE_ORDER.indexOf(state.profile) + 1) % PROFILE_ORDER.length;
  setProfile(PROFILE_ORDER[nextIndex]);
  showToast(`${PROFILE_META[state.profile].label}: ${PROFILE_META[state.profile].status}.`);
}

function setProfile(profile) {
  if (!PROFILE_ORDER.includes(profile)) return;
  state.profile = profile;
  tracker.setProfile(profile);
  saveState();
  updateInterface();
}

async function toggleListening() {
  if (shouldListen) stopListening("Listening paused", "Tap Listen whenever you are ready");
  else await startListening();
}

async function startListening() {
  if (shouldListen) return;
  const generation = ++listeningGeneration;
  shouldListen = true;
  setListeningUI(true);
  if (!chantReferencesReady && chantReferencesPromise) {
    setStatus("Preparing the melody listener", "Loading the compact chant references", "ready");
    await Promise.race([
      chantReferencesPromise,
      new Promise((resolve) => window.setTimeout(resolve, 900))
    ]);
  }
  if (generation !== listeningGeneration || !shouldListen) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const acousticSupported = Boolean(
    navigator.mediaDevices?.getUserMedia
    && (window.AudioContext || window.webkitAudioContext)
  );
  if (!SpeechRecognition && !acousticSupported) {
    stopListening("Manual following is ready", "Microphone tracking is not supported in this browser", "error");
    showToast("Live tracking works best in Chrome on Android. You can still follow with the arrow buttons on this device.");
    return;
  }

  if (!window.isSecureContext) {
    stopListening("Secure connection required", "Open the published HTTPS website to use the microphone", "error");
    return;
  }

  shouldListen = true;
  recognitionResultCount = 0;
  lastRecognitionAt = 0;
  lastAcousticMatchAt = 0;
  tracker.clearContext();
  chantMatcher.reset();
  setListeningUI(true);
  setStatus("Starting Hebrew listener", "Allow microphone access if your device asks", "live");

  try {
    await requestWakeLock();
    if (generation !== listeningGeneration || !shouldListen) return;
    let acousticStarted = false;
    try {
      acousticStarted = await startAcousticAnalysis(generation);
      if (shouldListen && acousticSession.analyser) {
        const hasMelodyReferences = chantReferenceCount > 0;
        const mode = SpeechRecognition && hasMelodyReferences
          ? "words and melody"
          : SpeechRecognition ? "the words" : "the melody";
        setStatus(`Listening for ${mode}`, "Sing or play the service normally", "live");
      }
    } catch (error) {
      if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") throw error;
      // Web Audio is an enhancement. Browser speech recognition can still run without it.
    }
    if (generation !== listeningGeneration || !shouldListen) return;
    if (SpeechRecognition) {
      createRecognition(SpeechRecognition);
      recognition.start();
    } else if (!acousticStarted) {
      throw new Error("No live audio tracker is available");
    }
  } catch (error) {
    if (generation !== listeningGeneration || !shouldListen) return;
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      stopListening("Microphone permission needed", "Enable microphone access in your browser settings", "error");
    } else {
      stopListening("Could not start listening", "Try again or follow manually with the arrows", "error");
    }
  }
}

function createRecognition(Recognition) {
  recognition?.stop();
  recognition = new SpeechSession({
    Recognition,
    configure: addPrayerPhraseHints,
    releaseMicrophone: stopAcousticAnalysis,
    onState: (phase, reason) => {
      if (!shouldListen) return;
      if (phase === "unavailable") {
        const detail = reason === "language-not-supported"
          ? "This browser's word service does not support Hebrew"
          : "Allow speech recognition in browser settings, then tap Retry";
        setStatus("Word recognition unavailable", detail, "error");
        elements.retryListener.hidden = false;
      } else if (phase === "retry" || phase === "recovering") {
        const detail = reason === "network"
          ? "Check your connection; retrying the Hebrew word service"
          : "Reconnecting automatically. Tap your current line to set your place.";
        setStatus("Waiting for recognized words", detail, "error");
        elements.retryListener.hidden = false;
      } else {
        setStatus("Listening for Hebrew words", "The highlighted phrase moves when words match", "ready");
      }
    },
    onResult: event => {
      if (!shouldListen) return;
      recognitionResultCount += 1;
      elements.retryListener.hidden = true;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const candidates = Array.from(result, alternative => ({
          transcript: alternative.transcript, confidence: alternative.confidence
        }));
        processSpeech(candidates, !result.isFinal);
      }
    }
  });
}

function addPrayerPhraseHints(listener) {
  const Phrase = window.SpeechRecognitionPhrase || window.webkitSpeechRecognitionPhrase;
  if (!Phrase || !("phrases" in listener)) return;
  const start = Math.max(0, tracker.currentIndex - 4);
  const end = Math.min(state.prayers.length, tracker.currentIndex + 32);
  try {
    const hints = new Map();
    const addHint = (line, boost) => {
      const phrase = String(line?.he || "").trim().slice(0, 140);
      if (phrase && !hints.has(phrase)) hints.set(phrase, boost);
    };
    state.prayers.slice(start, end).forEach((line) => addHint(line, 2.0));

    // Keep a sparse set of anchors from the whole service. This gives an
    // unfamiliar melody a chance to re-acquire globally instead of biasing the
    // recognizer only toward the saved position.
    const globalBudget = 64;
    const stride = Math.max(1, Math.floor(state.prayers.length / globalBudget));
    for (let index = 0; index < state.prayers.length && hints.size < 112; index += stride) {
      addHint(state.prayers[index], 1.25);
    }
    listener.phrases = [...hints].map(([phrase, boost]) => new Phrase(phrase, boost));
  } catch {
    // Contextual biasing is optional across browsers.
  }
}

function processSpeech(candidates, partial) {
  const acoustic = currentAcousticEvidence();
  const result = tracker.accept(candidates, {
    partial,
    acoustic
  });
  if (result.transcript) {
    elements.heardText.replaceChildren();
    const label = document.createElement("span");
    label.textContent = partial ? "Hearing" : "Heard";
    const transcript = document.createElement("b");
    transcript.lang = "he";
    transcript.dir = "rtl";
    transcript.textContent = result.transcript;
    elements.heardText.append(label, transcript);
    elements.heardText.classList.add("is-hearing");
  }

  if (result.moved) {
    state.currentIndex = result.index;
    saveState();
    if (recognition?.listener && recognition.hints) addPrayerPhraseHints(recognition.listener);
    updateInterface({ scroll: true, immediate: true });
    if (result.acousticConfirmed) acousticSession.boundaryAt = 0;
  } else if (shouldListen) {
    keepCurrentVisible();
  }

  if (result.score > 0.3) {
    lastRecognitionAt = Date.now();
    const confidence = Math.round(result.score * 100);
    const title = result.awaitingConfirmation
      ? "Confirming your place"
      : result.moved ? "Following the chazzan" : "Checking the recognized words";
    const signal = result.acousticConfirmed ? "chant + words" : "word match";
    setStatus(title, `${confidence}% ${signal} · ${PROFILE_META[state.profile].status}`, result.moved ? "live" : "ready");
  } else {
    setStatus("Words heard — finding your place", "Tap the phrase being sung to help tracking lock on", "ready");
  }
}

async function startAcousticAnalysis(generation = listeningGeneration) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !AudioContextClass) return false;
  stopAcousticAnalysis();

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1
    },
    video: false
  });
  if (!shouldListen || generation !== listeningGeneration) {
    stream.getTracks().forEach(track => track.stop());
    return false;
  }
  const context = new AudioContextClass({ latencyHint: "interactive" });
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  // Keep fingerprint frames responsive and close to the unsmoothed training data.
  analyser.smoothingTimeConstant = 0.15;
  source.connect(analyser);
  if (context.state === "suspended") await context.resume();
  if (!shouldListen || generation !== listeningGeneration) {
    stream.getTracks().forEach(track => track.stop());
    await context.close();
    return false;
  }

  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.addEventListener("mute", () => {
      if (shouldListen && acousticSession.stream === stream) {
        setStatus("Microphone paused", "Waiting for the browser to restore live audio", "error");
      }
    });
    audioTrack.addEventListener("unmute", () => {
      if (shouldListen && acousticSession.stream === stream) {
        setStatus("Microphone restored", "Listening for the congregation", "live");
      }
    });
    audioTrack.addEventListener("ended", () => recoverAcousticAnalysis(stream));
  }

  Object.assign(acousticSession, {
    stream,
    context,
    source,
    analyser,
    timeData: new Float32Array(analyser.fftSize),
    frequencyData: new Float32Array(analyser.frequencyBinCount),
    lastFrameAt: 0,
    noiseFloor: 0.0015,
    peakLevel: 0.01,
    active: false,
    activeSince: 0,
    quietSince: 0,
    lastActiveAt: 0,
    boundaryAt: 0,
    lastPhraseDuration: 0,
    lastChroma: null,
    melodyMovement: 0,
    lastReferenceFrameAt: 0,
    rms: 0,
    enterThreshold: 0,
    exitThreshold: 0
  });
  elements.waveform.classList.add("is-measured");
  acousticSession.frameRequest = requestAnimationFrame(updateAcousticAnalysis);
  return true;
}

function updateAcousticAnalysis(timestamp) {
  if (!acousticSession.analyser || !shouldListen) return;
  acousticSession.frameRequest = requestAnimationFrame(updateAcousticAnalysis);
  if (timestamp - acousticSession.lastFrameAt < 70) return;
  acousticSession.lastFrameAt = timestamp;

  const { analyser, timeData, frequencyData } = acousticSession;
  analyser.getFloatTimeDomainData(timeData);
  analyser.getFloatFrequencyData(frequencyData);

  let energy = 0;
  for (let index = 0; index < timeData.length; index += 1) energy += timeData[index] * timeData[index];
  const rms = Math.sqrt(energy / Math.max(1, timeData.length));
  const now = Date.now();
  acousticSession.peakLevel = Math.max(rms, acousticSession.peakLevel * 0.992);
  if (rms < acousticSession.noiseFloor * 1.7) {
    const smoothing = rms < acousticSession.noiseFloor ? 0.07 : 0.012;
    acousticSession.noiseFloor += (rms - acousticSession.noiseFloor) * smoothing;
  }

  const contrast = Math.max(0.003, acousticSession.peakLevel - acousticSession.noiseFloor);
  const enterThreshold = acousticSession.noiseFloor + Math.max(0.0015, contrast * 0.2);
  const exitThreshold = acousticSession.noiseFloor + Math.max(0.0008, contrast * 0.1);
  acousticSession.rms = rms;
  acousticSession.enterThreshold = enterThreshold;
  acousticSession.exitThreshold = exitThreshold;

  if (!acousticSession.active && rms >= enterThreshold) {
    acousticSession.active = true;
    acousticSession.activeSince = now;
    acousticSession.quietSince = 0;
  }
  if (acousticSession.active) {
    if (rms > exitThreshold) {
      acousticSession.lastActiveAt = now;
      acousticSession.quietSince = 0;
    } else {
      if (!acousticSession.quietSince) acousticSession.quietSince = now;
      const quietNeeded = state.profile === "balanced" ? 140 : state.profile === "hard" ? 220 : 180;
      const phraseDuration = acousticSession.quietSince - acousticSession.activeSince;
      if (now - acousticSession.quietSince >= quietNeeded && phraseDuration >= 650) {
        acousticSession.active = false;
        acousticSession.boundaryAt = now;
        acousticSession.lastPhraseDuration = phraseDuration;
        acousticSession.quietSince = 0;
      }
    }
  }

  const chroma = updateChroma(frequencyData);
  if (chroma && timestamp - acousticSession.lastReferenceFrameAt >= 120) {
    const frameInterval = acousticSession.lastReferenceFrameAt
      ? timestamp - acousticSession.lastReferenceFrameAt
      : 0;
    acousticSession.lastReferenceFrameAt = timestamp;
    const bands = spectralShape(frequencyData, analyser, acousticSession.context);
    const matchStarted = performance.now();
    const result = chantMatcher.observe(chroma, bands);
    result.processingMs = performance.now() - matchStarted;
    result.frameIntervalMs = frameInterval;
    processReferenceMatch(result);
  }
  updateMeasuredWaveform(frequencyData, rms);
}

function updateChroma(frequencyData) {
  const { analyser, context } = acousticSession;
  if (!analyser || !context) return null;
  const chroma = new Float64Array(12);
  const binWidth = context.sampleRate / analyser.fftSize;
  let norm = 0;
  for (let bin = Math.ceil(80 / binWidth); bin < frequencyData.length; bin += 1) {
    const frequency = bin * binWidth;
    if (frequency > 1200) break;
    const decibels = frequencyData[bin];
    if (!Number.isFinite(decibels) || decibels < -95) continue;
    const power = 10 ** (decibels / 10);
    const pitchClass = ((Math.round(12 * Math.log2(frequency / 440)) % 12) + 12) % 12;
    chroma[pitchClass] += power;
  }
  for (let index = 0; index < chroma.length; index += 1) norm += chroma[index] * chroma[index];
  norm = Math.sqrt(norm);
  if (norm < 1e-8) return null;
  for (let index = 0; index < chroma.length; index += 1) chroma[index] /= norm;

  if (acousticSession.lastChroma) {
    let similarity = 0;
    for (let index = 0; index < chroma.length; index += 1) {
      similarity += chroma[index] * acousticSession.lastChroma[index];
    }
    const novelty = clamp(1 - similarity, 0, 1);
    acousticSession.melodyMovement = acousticSession.melodyMovement * 0.78 + novelty * 0.22;
  }
  acousticSession.lastChroma = chroma;
  return chroma;
}

function spectralShape(frequencyData, analyser, context) {
  const bandCount = 18;
  const output = new Float64Array(bandCount);
  const binWidth = context.sampleRate / analyser.fftSize;
  const minimum = 100;
  const maximum = 5000;
  let mean = 0;
  for (let band = 0; band < bandCount; band += 1) {
    const low = minimum * (maximum / minimum) ** (band / bandCount);
    const high = minimum * (maximum / minimum) ** ((band + 1) / bandCount);
    const start = Math.max(1, Math.ceil(low / binWidth));
    const end = Math.min(frequencyData.length, Math.max(start + 1, Math.ceil(high / binWidth)));
    let power = 0;
    for (let bin = start; bin < end; bin += 1) {
      const decibels = frequencyData[bin];
      if (Number.isFinite(decibels)) power += 10 ** (decibels / 10);
    }
    output[band] = Math.log(Math.max(1e-12, power));
    mean += output[band];
  }
  mean /= bandCount;
  let norm = 0;
  for (let band = 0; band < bandCount; band += 1) {
    output[band] -= mean;
    norm += output[band] * output[band];
  }
  norm = Math.sqrt(norm) || 1;
  for (let band = 0; band < bandCount; band += 1) output[band] /= norm;
  return output;
}

function processReferenceMatch(result) {
  const audioTrack = acousticSession.stream?.getAudioTracks()[0];
  globalThis.__selichotAudioDebug = {
    score: Math.round((result.score || 0) * 1000) / 1000,
    margin: Math.round((result.margin || 0) * 1000) / 1000,
    matched: Boolean(result.matched),
    stable: Boolean(result.stable),
    index: result.index,
    referenceId: result.referenceId || "",
    evidence: result.evidence || 0,
    requiredEvidence: result.requiredHits || 0,
    locked: Boolean(result.locked),
    processingMs: Math.round((result.processingMs || 0) * 10) / 10,
    frameIntervalMs: Math.round(result.frameIntervalMs || 0),
    references: {
      ready: chantReferencesReady,
      count: chantReferenceCount,
      error: chantReferenceError,
      coverage: chantMatcher.getCoverage?.() || []
    },
    microphone: {
      readyState: audioTrack?.readyState || "none",
      muted: Boolean(audioTrack?.muted),
      rms: Math.round(acousticSession.rms * 100000) / 100000,
      noiseFloor: Math.round(acousticSession.noiseFloor * 100000) / 100000,
      enterThreshold: Math.round(acousticSession.enterThreshold * 100000) / 100000
    },
    speechRecognition: {
      active: Boolean(recognition?.listener),
      exclusiveMicrophone: Boolean(recognition?.exclusive),
      sharedTrack: false,
      results: recognitionResultCount
    }
  };
  if (!result.matched) return;
  if (!result.stable) {
    const title = result.locked ? "Following the matched chant" : "Recognizing this melody";
    const detail = result.locked
      ? `${Math.round(result.score * 100)}% match · confirming the next phrase`
      : `${Math.round(result.score * 100)}% acoustic match`;
    setStatus(title, detail, "live");
    return;
  }

  const now = Date.now();
  lastAcousticMatchAt = now;
  if (result.index !== state.currentIndex && now - lastReferenceMoveAt >= 650) {
    state.currentIndex = result.index;
    tracker.setCurrentIndex(result.index);
    tracker.clearContext();
    saveState();
    updateInterface({ scroll: true, immediate: true });
    lastReferenceMoveAt = now;
  }
  setStatus("Matched the chant", `${result.label} · ${Math.round(result.score * 100)}% melody + voiceprint`, "live");
}

function recoverAcousticAnalysis(failedStream) {
  if (!shouldListen || recognition?.exclusive || acousticSession.stream !== failedStream || acousticRecovering) return;
  clearTimeout(acousticRecoveryTimer);
  setStatus("Restoring the microphone", "The live audio stream ended unexpectedly", "live");
  acousticRecoveryTimer = window.setTimeout(async () => {
    if (!shouldListen || recognition?.exclusive || acousticSession.stream !== failedStream || acousticRecovering) return;
    acousticRecovering = true;
    try {
      await startAcousticAnalysis();
      if (shouldListen) setStatus("Microphone restored", "Listening for the congregation", "live");
    } catch {
      if (shouldListen) {
        stopListening("Microphone stopped", "Tap Listen to grant microphone access again", "error");
      }
    } finally {
      acousticRecovering = false;
    }
  }, 350);
}

function updateMeasuredWaveform(frequencyData, rms) {
  const count = elements.waveBars.length;
  elements.waveBars.forEach((bar, index) => {
    const start = Math.floor((index / count) ** 1.7 * Math.min(frequencyData.length, 220));
    const end = Math.max(start + 1, Math.floor(((index + 1) / count) ** 1.7 * Math.min(frequencyData.length, 220)));
    let strongest = -100;
    for (let bin = start; bin < end; bin += 1) strongest = Math.max(strongest, frequencyData[bin] || -100);
    const spectralHeight = clamp((strongest + 82) / 55, 0, 1);
    const levelHeight = clamp(rms * 9, 0, 1);
    bar.style.height = `${Math.round(3 + Math.max(spectralHeight, levelHeight * 0.45) * 27)}px`;
  });
}

function currentAcousticEvidence() {
  const now = Date.now();
  return {
    recentSpeech: now - acousticSession.lastActiveAt < 1500,
    phraseBoundary: acousticSession.boundaryAt > 0 && now - acousticSession.boundaryAt < 900,
    melodyMovement: acousticSession.melodyMovement
  };
}

function stopAcousticAnalysis() {
  clearTimeout(acousticRecoveryTimer);
  acousticRecoveryTimer = 0;
  if (acousticSession.frameRequest) cancelAnimationFrame(acousticSession.frameRequest);
  acousticSession.frameRequest = 0;
  try { acousticSession.source?.disconnect(); } catch { /* already disconnected */ }
  try { acousticSession.analyser?.disconnect(); } catch { /* already disconnected */ }
  acousticSession.stream?.getTracks().forEach((track) => track.stop());
  acousticSession.context?.close().catch(() => {});
  acousticSession.stream = null;
  acousticSession.context = null;
  acousticSession.source = null;
  acousticSession.analyser = null;
  elements.waveform.classList.remove("is-measured");
  elements.waveBars.forEach(bar => { bar.style.height = "3px"; });
  acousticSession.boundaryAt = 0;
  acousticSession.lastPhraseDuration = 0;
  acousticSession.lastActiveAt = 0;
  acousticSession.lastReferenceFrameAt = 0;
  acousticSession.rms = 0;
  acousticSession.enterThreshold = 0;
  acousticSession.exitThreshold = 0;
}

function stopListening(title = "Listening paused", subtitle = "Tap Listen whenever you are ready", kind = "ready") {
  shouldListen = false;
  listeningGeneration += 1;
  recognition?.stop();
  recognition = null;
  elements.retryListener.hidden = true;
  stopAcousticAnalysis();
  releaseWakeLock();
  setListeningUI(false);
  setStatus(title, subtitle, kind);
}

function setListeningUI(live) {
  elements.listenButton.classList.toggle("is-live", live);
  elements.waveform.classList.toggle("is-live", live);
  elements.statusDot.classList.toggle("is-live", live);
  elements.listenButtonStrong.textContent = live ? "Stop" : "Listen";
  elements.listenButtonSmall.textContent = live ? "עצור" : "האזן";
  elements.listenButton.setAttribute("aria-label", live ? "Stop listening" : "Start listening");
  if (!live) {
    elements.waveBars.forEach((bar) => { bar.style.height = "3px"; });
  }
}

function setStatus(title, subtitle, kind = "ready") {
  elements.statusText.textContent = title;
  elements.statusSubtext.textContent = subtitle;
  elements.statusDot.classList.toggle("is-live", kind === "live");
  elements.statusDot.classList.toggle("is-error", kind === "error");
}

async function requestWakeLock() {
  try {
    if ("wakeLock" in navigator) {
      const lock = await navigator.wakeLock.request("screen");
      if (!shouldListen) { await lock.release(); return; }
      wakeLock = lock;
    }
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

async function loadFullText({ userInitiated = true } = {}) {
  elements.downloadText.disabled = true;
  const originalLabel = elements.downloadText.querySelector("b").textContent;
  elements.downloadText.querySelector("b").textContent = "Loading the service…";
  if (userInitiated) setStatus("Loading the full service", "Downloading bilingual Sephardic text", "ready");

  const originalPrayers = state.prayers;
  try {
    let data;
    if (userInitiated) {
      try {
        const response = await fetch(SEFARIA_URL, {
          headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000)
        });
        if (!response.ok) throw new Error(`Sefaria responded ${response.status}`);
        data = await response.json();
      } catch { /* The bundled complete service also works offline. */ }
    }
    if (!data) {
      const response = await fetch("/service-text.json?v=1.6.1");
      if (!response.ok) throw new Error("Service text unavailable");
      data = await response.json();
    }
    if (state.prayers !== originalPrayers) return false;
    const prayers = prayersFromSefaria(data);
    if (prayers.length < 20) throw new Error("The downloaded service did not contain enough phrases");
    const previousLine = state.prayers[state.currentIndex]?.he;
    state.prayers = prayers;
    state.source = "sefaria";
    state.currentIndex = Math.max(0, prayers.findIndex(line =>
      normalizeHebrew(line.he).includes(normalizeHebrew(previousLine))));
    tracker.setLines(prayers);
    chantMatcher.setLines(prayers);
    tracker.setCurrentIndex(state.currentIndex);
    tracker.setProfile(state.profile);
    saveState();
    renderPrayers({ scroll: true });
    if (!shouldListen) setStatus("Full service ready", `${prayers.length} bilingual phrases · available offline`, "ready");
    showToast(`Full Sephardic service loaded: ${prayers.length} bilingual phrases.`);
    return true;
  } catch (error) {
    setStatus("Starter text is ready", "The full service could not be downloaded", "error");
    if (userInitiated) showToast("Could not reach Sefaria. Your current prayer text was kept.");
    return false;
  } finally {
    elements.downloadText.disabled = false;
    elements.downloadText.querySelector("b").textContent = originalLabel;
  }
}

function prayersFromSefaria(root) {
  const raw = [];
  flattenParallel(root?.he, root?.text, raw);
  return raw.flatMap(splitParallel).filter(validPrayer);
}

function flattenParallel(hebrew, english, output) {
  if (typeof hebrew === "string") {
    const he = stripHtml(hebrew);
    const en = typeof english === "string" ? stripHtml(english) : "";
    if (he) output.push({ he, en, title: sectionTitle(hebrew) });
    return;
  }
  if (!Array.isArray(hebrew)) return;
  hebrew.forEach((child, index) => {
    flattenParallel(child, Array.isArray(english) ? english[index] : null, output);
  });
}

function splitParallel(source) {
  const hebrew = splitTrackable(source.he, true);
  const english = splitTrackable(source.en, false);
  return hebrew.map((he, index) => {
    const mapped = english.length ? Math.min(english.length - 1, Math.floor(index * english.length / hebrew.length)) : -1;
    return { he, en: mapped >= 0 ? english[mapped] : "", title: index === 0 ? source.title : "" };
  });
}

function sectionTitle(value) {
  const match = String(value || "").match(/<b[^>]*>([^<]+)<\/b>/i);
  if (!match) return "";
  return stripHtml(match[1]).split(/\s+/).slice(0, 4).join(" ");
}

function splitTrackable(text, hebrew) {
  if (!text?.trim()) return [];
  const cleaned = text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  const sentencePattern = hebrew ? /(?<=[.:;!?׃])\s+/u : /(?<=[.!?;:])\s+/u;
  const softLimit = hebrew ? 105 : 165;
  const minimum = hebrew ? 32 : 45;
  const output = [];

  cleaned.split(sentencePattern).forEach((sentence) => {
    const value = sentence.trim();
    if (!value) return;
    if (value.length <= softLimit) {
      output.push(value);
      return;
    }
    let chunk = "";
    value.split(" ").forEach((word) => {
      if (chunk.length + word.length + 1 > softLimit && chunk.length >= minimum) {
        output.push(chunk);
        chunk = "";
      }
      chunk = chunk ? `${chunk} ${word}` : word;
    });
    if (chunk) output.push(chunk);
  });
  return output;
}

function stripHtml(value) {
  const template = document.createElement("template");
  template.innerHTML = value || "";
  return (template.content.textContent || "").replace(/\s+/g, " ").trim();
}

function openEditor() {
  elements.settingsDialog.close();
  elements.prayerEditor.value = state.prayers.map((line) => line.he).join("\n");
  elements.editDialog.showModal();
  window.setTimeout(() => elements.prayerEditor.focus(), 80);
}

function saveCustomText() {
  const prayers = elements.prayerEditor.value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((he) => ({ he, en: "" }));
  if (!prayers.length) {
    showToast("Add at least one Hebrew prayer phrase before saving.");
    return;
  }
  stopListening();
  state.prayers = prayers;
  state.source = "custom";
  state.currentIndex = 0;
  tracker.setLines(prayers);
  chantMatcher.setLines(prayers);
  tracker.setCurrentIndex(0);
  tracker.setProfile(state.profile);
  saveState();
  renderPrayers({ scroll: true });
  elements.editDialog.close();
  showToast(`Custom nusach saved with ${prayers.length} phrases.`);
}

function restoreStarterText() {
  if (!window.confirm("Replace the current prayer text with the 17 starter phrases?")) return;
  stopListening();
  state.prayers = [...STARTER_LINES];
  state.source = "starter";
  state.currentIndex = 0;
  tracker.setLines(state.prayers);
  chantMatcher.setLines(state.prayers);
  tracker.setCurrentIndex(0);
  tracker.setProfile(state.profile);
  saveState();
  renderPrayers({ scroll: true });
  showToast("Starter prayer text restored.");
}

function resetProgress() {
  setCurrentIndex(0, { scroll: true, manual: true });
  showToast("Your place was reset to the beginning.");
}

function showInstallDialog() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  elements.installInstructions.replaceChildren();

  if (standalone) {
    addInstallStep("✓", "Selichot is already installed on this device.");
    elements.nativeInstall.hidden = true;
  } else if (isiOS) {
    addInstallStep("1", "Open this website in Safari.");
    addInstallStep("2", "Tap the Share button at the bottom of Safari.");
    addInstallStep("3", "Choose “Add to Home Screen,” then tap Add.");
    elements.nativeInstall.hidden = true;
  } else if (deferredInstallPrompt) {
    addInstallStep("1", "Install the private, full-screen version on your home screen.");
    addInstallStep("2", "Open it like any app—even when your connection is weak.");
    elements.nativeInstall.hidden = false;
  } else if (isAndroid) {
    addInstallStep("1", "Open Chrome’s menu (⋮) in the top-right corner.");
    addInstallStep("2", "Choose “Install app” or “Add to Home screen.”");
    elements.nativeInstall.hidden = true;
  } else {
    addInstallStep("1", "Open your browser menu and choose Install or Add to Home Screen.");
    addInstallStep("2", "Selichot will open in its own focused app window.");
    elements.nativeInstall.hidden = true;
  }
  elements.installDialog.showModal();
}

function addInstallStep(number, copy) {
  const step = document.createElement("div");
  step.className = "install-step";
  const badge = document.createElement("span");
  badge.textContent = number;
  const text = document.createElement("div");
  text.textContent = copy;
  step.append(badge, text);
  elements.installInstructions.append(step);
}

async function runNativeInstall() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  elements.installDialog.close();
  if (choice.outcome === "accepted") showToast("Selichot is being added to your device.");
}

function updateOnlineState() {
  const online = navigator.onLine;
  elements.onlineState.classList.toggle("is-offline", !online);
  elements.onlineState.querySelector("span").textContent = online ? "Online" : "Offline ready";
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), 3600);
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function closeOnBackdrop(dialog) {
  dialog.addEventListener("click", (event) => {
    const bounds = dialog.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    if (!inside) dialog.close();
  });
}

function bindEvents() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  elements.previousButton.addEventListener("click", () => moveCurrent(-1));
  elements.nextButton.addEventListener("click", () => moveCurrent(1));
  elements.firstButton.addEventListener("click", () => jumpToBoundary(0));
  elements.lastButton.addEventListener("click", () => jumpToBoundary(state.prayers.length - 1));
  elements.listenButton.addEventListener("click", toggleListening);
  elements.displayModeButton.addEventListener("click", cycleDisplay);
  elements.profileButton.addEventListener("click", cycleProfile);
  elements.jumpCurrent.addEventListener("click", scrollToCurrent);
  elements.sectionOptions.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-index]");
    if (button) jumpToBoundary(Number(button.dataset.index));
  });
  elements.beginAgain.addEventListener("click", resetProgress);
  elements.settingsButton.addEventListener("click", () => elements.settingsDialog.showModal());
  document.querySelectorAll("[data-install]").forEach((button) => button.addEventListener("click", showInstallDialog));
  elements.nativeInstall.addEventListener("click", runNativeInstall);
  elements.displayOptions.forEach((button) => button.addEventListener("click", () => setDisplay(button.dataset.display)));
  elements.profileOptions.forEach((button) => button.addEventListener("click", () => setProfile(button.dataset.profile)));
  elements.fontSize.addEventListener("input", () => {
    state.fontSize = Number(elements.fontSize.value);
    document.documentElement.style.setProperty("--hebrew-size", `${state.fontSize}px`);
  });
  elements.fontSize.addEventListener("change", saveState);
  elements.downloadText.addEventListener("click", () => loadFullText({ userInitiated: true }));
  elements.editText.addEventListener("click", openEditor);
  elements.restoreText.addEventListener("click", restoreStarterText);
  elements.retryListener.addEventListener("click", () => {
    stopListening();
    startListening();
  });
  elements.resetProgress.addEventListener("click", resetProgress);
  elements.saveText.addEventListener("click", saveCustomText);
  [elements.settingsDialog, elements.installDialog, elements.editDialog].forEach(closeOnBackdrop);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    if (elements.installDialog.open) elements.installDialog.close();
    showToast("Selichot was installed successfully.");
  });
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);
  window.addEventListener("pageshow", () => {
    window.setTimeout(() => scrollToCurrent({ immediate: true }), 450);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && shouldListen && !wakeLock) requestWakeLock();
  });
  window.addEventListener("beforeunload", () => stopListening());
  document.addEventListener("keydown", (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLButtonElement) return;
    if (event.key === "ArrowLeft") moveCurrent(-1);
    if (event.key === "ArrowRight") moveCurrent(1);
    if (event.key === " ") {
      event.preventDefault();
      toggleListening();
    }
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
  } catch {
    // The app remains fully usable online if registration is unavailable.
  }
}

async function loadChantReferences() {
  try {
    const response = await fetch("/audio-references.json?v=1.6.1", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Reference download failed: ${response.status}`);
    const payload = await response.json();
    chantMatcher.load(payload);
    chantMatcher.setLines(state.prayers);
    chantReferenceCount = Array.isArray(payload.references) ? payload.references.length : 0;
    chantReferencesReady = chantReferenceCount > 0;
    chantReferenceError = "";
    return chantReferencesReady;
  } catch (error) {
    chantReferencesReady = false;
    chantReferenceCount = 0;
    chantReferenceError = error?.message || "Reference download failed";
    // Browser word recognition remains available if fingerprints cannot load.
    return false;
  }
}

function initialize() {
  // A saved position can be hundreds of phrases into the service. Center it
  // immediately on reload so phones never show the beginning while the header
  // claims a very different current line.
  renderPrayers({ scroll: true });
  settleCurrentScroll();
  updateOnlineState();
  bindEvents();
  registerServiceWorker();
  chantReferencesPromise = loadChantReferences();
  if (state.source === "starter") {
    loadFullText({ userInitiated: false });
  }
}

initialize();
