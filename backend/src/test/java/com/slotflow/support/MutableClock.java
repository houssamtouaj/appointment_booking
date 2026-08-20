package com.slotflow.support;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/**
 * A {@link Clock} the test can move.
 *
 * <p>{@code Clock.fixed} is enough for a unit test, but an integration test often needs two
 * different "now"s in one run: create a booking, <em>then</em> jump forward thirty-one minutes and
 * let the sweeper see it as expired (D3). Restarting the Spring context between those two steps to
 * swap a fixed clock would cost more than the rest of the suite put together.
 *
 * <p>Registered as the primary {@code Clock} for every integration test, so it is what the JPA
 * auditing provider and every service written from plan 05 onwards read. Moving it moves
 * everything at once, which is the only way a time-dependent assertion can be honest.
 */
public final class MutableClock extends Clock {

    private final ZoneId zone;
    private volatile Instant instant;

    public MutableClock(Instant instant, ZoneId zone) {
        this.instant = instant;
        this.zone = zone;
    }

    public static MutableClock startingAtTestTime() {
        return new MutableClock(TestTime.NOW, ZoneOffset.UTC);
    }

    @Override
    public Instant instant() {
        return instant;
    }

    @Override
    public ZoneId getZone() {
        return zone;
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new MutableClock(instant, zone);
    }

    public void setTo(Instant instant) {
        this.instant = instant;
    }

    public void advanceBy(Duration duration) {
        this.instant = this.instant.plus(duration);
    }

    /** Called before every integration test, so one test's time travel cannot reach the next. */
    public void reset() {
        this.instant = TestTime.NOW;
    }
}
