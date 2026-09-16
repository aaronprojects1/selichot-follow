package com.selichot.follow;

import org.junit.Test;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class ChantAcousticTrackerTest {
    @Test
    public void sustainedChantThenPauseCreatesOneBoundary() {
        ChantAcousticTracker tracker = new ChantAcousticTracker();
        tracker.reset();
        ChantAcousticTracker.Event event = ChantAcousticTracker.Event.NONE;
        long now = 1000;
        for (int i = 0; i < 24; i++, now += 100) {
            event = tracker.acceptLevel(0.72, now);
            assertFalse(event.phraseBoundary);
        }
        for (int i = 0; i < 8; i++, now += 100) {
            ChantAcousticTracker.Event next = tracker.acceptLevel(0.08, now);
            if (next.phraseBoundary) event = next;
        }
        assertTrue(event.phraseBoundary);
        assertTrue(event.strength >= 0.58);
        assertTrue(event.phraseDurationMs >= 850);
    }

    @Test
    public void noisePulsesCannotPretendToBeAChantedPhrase() {
        ChantAcousticTracker tracker = new ChantAcousticTracker();
        tracker.reset();
        long now = 1000;
        boolean boundary = false;
        for (int i = 0; i < 30; i++, now += 100) {
            double level = i % 4 == 0 ? 0.48 : 0.11;
            boundary |= tracker.acceptLevel(level, now).phraseBoundary;
        }
        assertFalse(boundary);
    }
}
