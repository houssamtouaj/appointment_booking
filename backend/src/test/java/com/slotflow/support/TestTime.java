package com.slotflow.support;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;

/**
 * One instant, shared by the whole suite.
 *
 * <p>Every test that cares about time starts from {@link #NOW}, so a failure message reads the
 * same on a laptop in July as in CI in December. A test that calls the real clock instead is a
 * test that will fail one day for a reason nobody can reproduce — plan 14 treats both that and a
 * {@code Thread.sleep} as review blockers.
 */
public final class TestTime {

    /**
     * Monday 2 March 2026, 09:00 UTC.
     *
     * <p>A Monday because {@code DayOfWeek.MONDAY} is where a weekly template starts, so
     * "today's hours" and "the first configured day" are the same thing and an off-by-one in
     * either shows up immediately. March because {@code Europe/Paris} changes to summer time
     * later that month, which puts plan 09's DST cases a few days away rather than six months.
     */
    public static final Instant NOW = Instant.parse("2026-03-02T09:00:00Z");

    private TestTime() {
    }

    /** For a pure unit test: a clock that does not move. */
    public static Clock fixed() {
        return Clock.fixed(NOW, ZoneOffset.UTC);
    }

    public static Clock fixedAt(String isoInstant) {
        return Clock.fixed(Instant.parse(isoInstant), ZoneOffset.UTC);
    }
}
