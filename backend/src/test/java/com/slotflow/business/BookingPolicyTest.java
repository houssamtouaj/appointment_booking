package com.slotflow.business;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The policy windows, against a clock that does not move.
 *
 * <p>These four numbers decide which slots a customer is offered, so every boundary here is one a
 * real booking will land on. Note that not one of these tests could exist if the policy read the
 * system clock: "today's slots are gone and tomorrow's are partial" is only assertable when
 * "today" is a value the test chose.
 */
class BookingPolicyTest {

    private static final Instant NOON = Instant.parse("2026-03-02T12:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOON, ZoneOffset.UTC);

    private static final UUID BUSINESS_ID = UUID.randomUUID();

    @Test
    @DisplayName("the lead time pushes the earliest bookable start forward")
    void leadTimeMovesTheEarliestStart() {
        BookingPolicy policy = policy(24, 60, 24, 15);

        assertThat(policy.earliestBookableAt(CLOCK.instant()))
                .isEqualTo(Instant.parse("2026-03-03T12:00:00Z"));
    }

    @Test
    @DisplayName("a zero lead time means right now is bookable")
    void zeroLeadTimeAllowsImmediateBooking() {
        BookingPolicy policy = policy(0, 60, 24, 15);

        assertThat(policy.earliestBookableAt(CLOCK.instant())).isEqualTo(NOON);
    }

    @Test
    @DisplayName("the advance limit closes the calendar exactly N days out")
    void maxAdvanceClosesTheCalendar() {
        BookingPolicy policy = policy(2, 7, 24, 15);

        assertThat(policy.latestBookableAt(CLOCK.instant()))
                .isEqualTo(Instant.parse("2026-03-09T12:00:00Z"));
    }

    @Test
    @DisplayName("the bookable window rejects both ends and accepts what is between them")
    void windowAcceptsAndRejectsAtBothEnds() {
        BookingPolicy policy = policy(24, 7, 24, 15);
        Instant now = CLOCK.instant();

        Instant justTooSoon = policy.earliestBookableAt(now).minusSeconds(1);
        Instant exactlyOnTheLeadTime = policy.earliestBookableAt(now);
        Instant exactlyOnTheHorizon = policy.latestBookableAt(now);
        Instant justPastTheHorizon = policy.latestBookableAt(now).plusSeconds(1);

        // The boundaries are inclusive: a slot that becomes bookable at 12:00 tomorrow is
        // bookable at 12:00 tomorrow, not a second later.
        assertThat(policy.isWithinBookableWindow(justTooSoon, now)).isFalse();
        assertThat(policy.isWithinBookableWindow(exactlyOnTheLeadTime, now)).isTrue();
        assertThat(policy.isWithinBookableWindow(exactlyOnTheHorizon, now)).isTrue();
        assertThat(policy.isWithinBookableWindow(justPastTheHorizon, now)).isFalse();
    }

    @Test
    @DisplayName("the cancellation deadline is the cutoff before the start, not before now")
    void cancellationDeadlineIsRelativeToTheAppointment() {
        BookingPolicy policy = policy(2, 60, 24, 15);
        Instant startsAt = Instant.parse("2026-03-05T09:00:00Z");

        assertThat(policy.cancellationDeadline(startsAt))
                .isEqualTo(Instant.parse("2026-03-04T09:00:00Z"));
    }

    @Test
    @DisplayName("cancelling is allowed up to the deadline and refused on it")
    void cancellationBoundaryFallsOneWay() {
        BookingPolicy policy = policy(2, 60, 24, 15);
        Instant startsAt = Instant.parse("2026-03-05T09:00:00Z");
        Instant deadline = policy.cancellationDeadline(startsAt);

        assertThat(policy.isCancellable(startsAt, deadline.minusSeconds(1))).isTrue();
        // Exactly on the deadline is too late. The boundary has to fall one way, and refusing is
        // the side that cannot surprise a business into an empty chair.
        assertThat(policy.isCancellable(startsAt, deadline)).isFalse();
        assertThat(policy.isCancellable(startsAt, deadline.plusSeconds(1))).isFalse();
    }

    @Test
    @DisplayName("a zero cutoff lets a customer cancel until the appointment starts")
    void zeroCutoffAllowsCancellingUntilTheStart() {
        BookingPolicy policy = policy(2, 60, 0, 15);
        Instant startsAt = Instant.parse("2026-03-05T09:00:00Z");

        assertThat(policy.isCancellable(startsAt, startsAt.minus(1, ChronoUnit.MINUTES))).isTrue();
        assertThat(policy.isCancellable(startsAt, startsAt)).isFalse();
    }

    @Test
    @DisplayName("the defaults match the schema, so a fresh business behaves as documented")
    void defaultsMatchTheSchema() {
        BookingPolicy policy = BookingPolicy.defaultsFor(BUSINESS_ID);

        assertThat(policy.getMinLeadTimeHours()).isEqualTo(2);
        assertThat(policy.getMaxAdvanceDays()).isEqualTo(60);
        assertThat(policy.getCancellationCutoffHours()).isEqualTo(24);
        assertThat(policy.getSlotGranularityMinutes()).isEqualTo(15);
        assertThat(policy.getBusinessId()).isEqualTo(BUSINESS_ID);
    }

    @Test
    @DisplayName("values the database would reject are refused before they get there")
    void invalidValuesAreRefused() {
        BookingPolicy policy = BookingPolicy.defaultsFor(BUSINESS_ID);

        assertThatThrownBy(() -> policy.setMinLeadTimeHours(-1))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.setMaxAdvanceDays(0))
                .as("a calendar open for zero days can never be booked")
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.setCancellationCutoffHours(-1))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.setSlotGranularityMinutes(0))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.setSlotGranularityMinutes(481))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static BookingPolicy policy(int leadHours, int advanceDays, int cutoffHours,
                                        int granularityMinutes) {
        return new BookingPolicy(BUSINESS_ID, leadHours, advanceDays, cutoffHours,
                granularityMinutes);
    }
}
