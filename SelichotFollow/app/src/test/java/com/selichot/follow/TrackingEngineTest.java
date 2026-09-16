package com.selichot.follow;

import org.junit.Test;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Arrays;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class TrackingEngineTest {
    @Test
    public void normalizationHandlesNiqqudFinalLettersAndDivineNames() {
        assertEquals("מלכ אדני", TrackingEngine.normalizeHebrew("מֶלֶךְ ה׳"));
        assertEquals("אדני אדני", TrackingEngine.normalizeHebrew("יְהוָה אֲדֹנָי"));
    }

    @Test
    public void exactHebrewAdvancesToTheRightPrayer() {
        TrackingEngine engine = engineWithStarter();
        TrackingEngine.Result result = engine.accept(
                Collections.singletonList("אל מלך יושב על כיסא רחמים"), new float[]{0.91f}, false);

        assertTrue(result.moved);
        assertEquals(7, result.index);
        assertTrue(result.score > 0.70);
    }

    @Test
    public void divineNameAliasMatchesHowPeopleActuallySayIt() {
        TrackingEngine engine = engineWithStarter();
        engine.setCurrentIndex(14);
        TrackingEngine.Result result = engine.accept(
                Collections.singletonList("אדוני אדוני אל רחום וחנון ארך אפיים"), null, false);

        assertTrue(result.moved);
        assertEquals(15, result.index);
        assertTrue(result.score > 0.72);
    }

    @Test
    public void repeatedEarlyRefrainDoesNotThrowTrackingBackward() {
        TrackingEngine engine = engineWithStarter();
        engine.setCurrentIndex(15);
        TrackingEngine.Result result = engine.accept(
                Collections.singletonList("שפוך שיחה דרוש סליחה מאדון האדונים"), null, false);

        assertFalse(result.moved);
        assertEquals(15, result.index);
    }

    @Test
    public void noisyLowInformationJumpNeedsConfirmation() {
        List<PrayerLine> lines = new ArrayList<>();
        for (int i = 0; i < 45; i++) {
            lines.add(new PrayerLine("קטע תפילה מספר " + hebrewNumber(i) + " מילים מיוחדות", ""));
        }
        lines.set(35, new PrayerLine("רחום וחנון חסד ואמת סליחה", ""));
        TrackingEngine engine = new TrackingEngine();
        engine.setLines(lines);
        engine.setRoomProfile(TrackingEngine.RoomProfile.HARD_TO_HEAR);
        engine.setAmbientNoise(0.9);
        engine.setSignalContrast(0.1);

        TrackingEngine.Result first = engine.accept(Collections.singletonList("רחום חסד"), null, true);
        assertFalse(first.moved);
        assertTrue(first.awaitingConfirmation || first.score < 0.5);
        assertEquals(0, first.index);
    }

    @Test
    public void considersLowerRankedHypothesesInLowContrastAudio() {
        TrackingEngine engine = engineWithStarter();
        List<String> hypotheses = new ArrayList<>(Arrays.asList(
                "זזז זזז", "בבב בבב", "טטט טטט", "קקק קקק",
                "פפפ פפפ", "צצצ צצצ", "גגג גגג", "דדד דדד",
                "אל מלך יושב על כיסא רחמים", "נננ נננ"));

        TrackingEngine.Result result = engine.accept(hypotheses, null, false);

        assertTrue(result.moved);
        assertEquals(7, result.index);
    }

    @Test
    public void sampleDerivedGarbledChantDoesNotCauseAWildJump() {
        TrackingEngine engine = engineWithStarter();
        engine.setAmbientNoise(0.82);
        engine.setSignalContrast(0.12);
        String[] lowContrastFragments = {
                "מהרדו או הלבד או הילדו או מה",
                "באונו ונוסח אי וככה נונא ירשם",
                "ניפן על נפי ידדו או נאי כירה פירחה",
                "וכה אלי צולטי מנוסח וצועתי",
                "כפסים לי ותיבתי היה לותי וגנותי",
                "וכך הכל משאדות לי ונגנתך אותה ותיבתי"
        };

        for (String fragment : lowContrastFragments) {
            engine.accept(Collections.singletonList(fragment), null, false);
        }

        assertTrue("Garbled chanting must not jump far through the service", engine.getCurrentIndex() <= 2);
    }

    @Test
    public void suppliedOpusAnchorReacquiresAfterANewChantPhrase() {
        TrackingEngine engine = engineWithStarter();
        String anchor = "אל רחום שמחה אל חנון שמחה אל ארך הפעים";

        TrackingEngine.Result first = engine.accept(
                Collections.singletonList(anchor), new float[]{0.35f}, true);
        assertFalse(first.moved);

        engine.noteAcousticBoundary(0.82);
        TrackingEngine.Result confirmed = engine.accept(
                Collections.singletonList(anchor), new float[]{0.35f}, true);
        assertTrue("score=" + confirmed.score + " margin=" + confirmed.margin
                + " index=" + confirmed.index + " awaiting=" + confirmed.awaitingConfirmation,
                confirmed.moved);
        assertEquals(15, confirmed.index);
    }

    @Test
    public void distinctiveFinalCanReanchorAcrossTheWholeService() {
        List<PrayerLine> lines = longService(145);
        lines.set(121, new PrayerLine("אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו", ""));
        TrackingEngine engine = new TrackingEngine();
        engine.setLines(lines);

        TrackingEngine.Result result = engine.accept(Collections.singletonList(
                "אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו"), new float[]{0.94f}, false);

        assertTrue(result.moved);
        assertTrue(result.reanchored);
        assertEquals(121, result.index);
        assertTrue(result.margin > 0.08);
    }

    @Test
    public void indexedGlobalReanchorWorksAtFullServiceScale() {
        List<PrayerLine> lines = longService(1422);
        lines.set(1300, new PrayerLine("אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו", ""));
        TrackingEngine engine = new TrackingEngine();
        engine.setLines(lines);

        TrackingEngine.Result result = engine.accept(Collections.singletonList(
                "אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו"), new float[]{0.95f}, false);

        assertTrue(result.moved);
        assertEquals(1300, result.index);
    }

    @Test
    public void identicalPartialCallbacksAreNotIndependentVotes() {
        List<PrayerLine> lines = longService(145);
        lines.set(121, new PrayerLine("אור חדש על ציון תאיר ונזכה כולנו מהרה לאורו", ""));
        TrackingEngine engine = new TrackingEngine();
        engine.setLines(lines);
        engine.setRoomProfile(TrackingEngine.RoomProfile.HARD_TO_HEAR);
        String noisyPartial = "אור חדש ציון תאיר ונזכה מהר לאור";

        TrackingEngine.Result first = engine.accept(
                Collections.singletonList(noisyPartial), null, true);
        TrackingEngine.Result duplicate = engine.accept(
                Collections.singletonList(noisyPartial), null, true);

        assertFalse(first.moved);
        assertFalse(duplicate.moved);
        assertEquals(0, duplicate.index);

        engine.noteAcousticBoundary(0.8);
        TrackingEngine.Result nextPhraseEvidence = engine.accept(
                Collections.singletonList(noisyPartial), null, true);
        assertTrue(nextPhraseEvidence.moved);
        assertEquals(121, nextPhraseEvidence.index);
    }

    @Test
    public void acousticsAloneNeverSelectAPrayer() {
        TrackingEngine engine = engineWithStarter();
        for (int i = 0; i < 20; i++) engine.noteAcousticBoundary(1.0);
        assertEquals(0, engine.getCurrentIndex());
    }

    @Test
    public void ambiguousRepeatedRefrainCannotCauseGlobalJump() {
        List<PrayerLine> lines = longService(175);
        String refrain = "עננו אבינו עננו עננו בוראנו עננו";
        lines.set(105, new PrayerLine(refrain, ""));
        lines.set(150, new PrayerLine(refrain, ""));
        TrackingEngine engine = new TrackingEngine();
        engine.setLines(lines);

        TrackingEngine.Result result = engine.accept(
                Collections.singletonList(refrain), new float[]{0.98f}, false);

        assertFalse(result.moved);
        assertEquals(0, result.index);
        assertTrue(result.margin < 0.04);
    }

    private TrackingEngine engineWithStarter() {
        TrackingEngine engine = new TrackingEngine();
        engine.setLines(PrayerRepository.starterLines());
        engine.setRoomProfile(TrackingEngine.RoomProfile.REVERBERANT);
        return engine;
    }

    private List<PrayerLine> longService(int count) {
        List<PrayerLine> lines = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            lines.add(new PrayerLine("קטע תפילה רגיל מספר " + hebrewNumber(i)
                    + " מילים חוזרות בקשה ותחנונים", ""));
        }
        return lines;
    }

    private String hebrewNumber(int value) {
        String[] words = {"אפס", "אחד", "שתים", "שלש", "ארבע", "חמש", "שש", "שבע", "שמונה", "תשע"};
        return words[value % words.length] + " " + words[(value / words.length) % words.length];
    }
}
