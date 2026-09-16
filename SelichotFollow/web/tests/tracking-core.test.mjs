import test from "node:test";
import assert from "node:assert/strict";

import { PrayerTracker, positionPrior } from "../tracking-core.mjs";

const STARTER_HEBREW = [
  "בן אדם מה לך נרדם קום קרא בתחנונים",
  "שפוך שיחה דרוש סליחה מאדון האדונים",
  "רחץ וטהר ואל תאחר בטרם ימים פונים",
  "ומהרה רוץ לעזרה לפני שוכן מעונים",
  "ומפשע וגם רשע ברח ופחד מאסונים",
  "אנא שעה שמך יודעי ישראל נאמנים",
  "לך אדני הצדקה ולנו בושת הפנים",
  "אל מלך יושב על כסא רחמים",
  "מתנהג בחסידות מוחל עוונות עמו",
  "מעביר ראשון ראשון מרבה מחילה לחטאים",
  "וסליחה לפושעים עושה צדקות עם כל בשר ורוח",
  "לא כרעתם גומל להם",
  "אל הורית לנו לומר שלש עשרה",
  "זכור לנו היום ברית שלש עשרה",
  "ויעבור אדני על פניו ויקרא",
  "אדני אדני אל רחום וחנון ארך אפים ורב חסד ואמת",
  "נוצר חסד לאלפים נושא עון ופשע וחטאה ונקה"
].map((he) => ({ he }));

function hebrewNumber(value) {
  const words = ["אפס", "אחד", "שתים", "שלש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"];
  return `${words[value % 10]} ${words[Math.floor(value / 10) % 10]}`;
}

function longService(count) {
  return Array.from({ length: count }, (_, index) => ({
    he: `קטע תפילה רגיל מספר ${hebrewNumber(index)} מילים חוזרות בקשה ותחנונים`
  }));
}

test("far-forward positions receive a penalty instead of a positive prior", () => {
  assert.ok(positionPrior(15) < 0);
  assert.ok(positionPrior(80) < positionPrior(15));
  assert.ok(positionPrior(2) > positionPrior(15));
});

test("a distinctive final globally reanchors after independent confirmation", () => {
  const lines = longService(145);
  lines[121] = { he: "אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו" };
  const tracker = new PrayerTracker();
  tracker.setLines(lines);

  const first = tracker.accept([{
    transcript: "אור חדש על ציון תאיר ונזכה כולנו",
    confidence: 0.9
  }], true);
  const result = tracker.accept([{
    transcript: "אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו",
    confidence: 0.95
  }], false);

  assert.equal(first.moved, false);
  assert.equal(first.awaitingConfirmation, true);
  assert.equal(result.moved, true);
  assert.equal(result.index, 121);
  assert.equal(result.reanchoring, true);
});

test("identical interim callbacks cannot satisfy consensus", () => {
  const lines = longService(145);
  lines[121] = { he: "אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו" };
  const tracker = new PrayerTracker();
  tracker.setLines(lines);
  tracker.setProfile("hard");
  const candidates = [{ transcript: "אור חדש ציון תאיר ונזכה מהר לאור", confidence: 0.62 }];

  const first = tracker.accept(candidates, true);
  const duplicate = tracker.accept(candidates, true);

  assert.equal(first.moved, false);
  assert.equal(duplicate.moved, false);
  assert.equal(duplicate.evidenceCount, 1);
});

test("a strong acoustic boundary can confirm text but cannot vote alone", () => {
  const lines = longService(145);
  lines[121] = { he: "אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו" };
  const tracker = new PrayerTracker();
  tracker.setLines(lines);
  tracker.setProfile("hard");
  tracker.setCurrentIndex(110);
  const candidates = [{ transcript: "אור חדש ציון תאיר ונזכה מהר לאור", confidence: 0.62 }];

  tracker.accept(candidates, true);
  const confirmed = tracker.accept(candidates, {
    partial: true,
    acoustic: { phraseBoundary: true, recentSpeech: true }
  });
  assert.equal(confirmed.moved, true);
  assert.equal(confirmed.index, 121);

  const before = tracker.currentIndex;
  const wordsMissing = tracker.accept([], {
    partial: true,
    acoustic: { phraseBoundary: true, recentSpeech: true }
  });
  assert.equal(wordsMissing.moved, false);
  assert.equal(tracker.currentIndex, before);
});

test("an ambiguous refrain outside the local window cannot jump", () => {
  const lines = longService(175);
  const refrain = "עננו אבינו עננו עננו בוראנו עננו";
  lines[105] = { he: refrain };
  lines[150] = { he: refrain };
  const tracker = new PrayerTracker();
  tracker.setLines(lines);

  const result = tracker.accept([{ transcript: refrain, confidence: 0.99 }], false);

  assert.equal(result.moved, false);
  assert.equal(result.index, 0);
});

test("one callback cannot pull tracking far backward", () => {
  const tracker = new PrayerTracker();
  const lines = longService(130);
  lines[10] = { he: "שפוך שיחה דרוש סליחה מאדון האדונים" };
  tracker.setLines(lines);
  tracker.setCurrentIndex(100);

  const result = tracker.accept([{
    transcript: "שפוך שיחה דרוש סליחה מאדון האדונים",
    confidence: 0.98
  }], false);

  assert.equal(result.moved, false);
  assert.equal(result.awaitingConfirmation, true);
  assert.equal(result.index, 100);
});

test("supplied low-contrast M4A transcript cannot cause a false jump", () => {
  const tracker = new PrayerTracker();
  tracker.setLines(STARTER_HEBREW);
  const fragments = [
    "מאמה הלו הלבדו הילדו מפ",
    "באונו ונוספעי וככה נונא ירשם",
    "ניפן ארפיאנדו נהי כירה פירחם",
    "וכה אלי צולטי מנוספתי וצועתי",
    "מבאסים לי ותיבתי היה לותי וגנותי",
    "לך כל משאדות לי ונגנתך אותך אותי"
  ];
  fragments.forEach((transcript) => tracker.accept([{ transcript, confidence: 0.2 }], false));
  assert.ok(tracker.currentIndex <= 2);
});

test("supplied Opus anchor plus a chant boundary finds the Thirteen Attributes", () => {
  const tracker = new PrayerTracker();
  tracker.setLines(STARTER_HEBREW);
  const result = tracker.accept([{
    transcript: "אל רחום שמחה אל חנון שמחה אל ארך הפעים",
    confidence: 0.35
  }], {
    partial: true,
    acoustic: { phraseBoundary: true, recentSpeech: true }
  });
  assert.equal(result.moved, true);
  assert.equal(result.index, 15);
});
