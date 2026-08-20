package com.slotflow.booking;

import java.util.Collection;
import java.util.EnumSet;
import java.util.Set;

/**
 * Where a booking is in its life.
 *
 * <p>{@code PENDING} means exactly one thing (D2): a Stripe deposit is in flight. A booking that
 * needs no deposit is created {@code CONFIRMED}, and staff never manually confirm anything — they
 * mark {@code COMPLETED}, {@code NO_SHOW} or {@code CANCELLED}. That removed a state whose owner
 * nobody could name.
 *
 * <p>Because {@code PENDING} holds the slot, it must not hold it forever: {@code expires_at} plus
 * the sweeper in plan 10 cancels an abandoned checkout after 30 minutes (D3).
 *
 * <p>The legal transitions live in {@link Booking}, not here — a status cannot check a clock, and
 * two of the transitions are time-guarded.
 */
public enum BookingStatus {

    /** A deposit is outstanding. Occupies the calendar; expires (D3). */
    PENDING,

    /** Booked and paid for as far as it needs to be. Occupies the calendar. */
    CONFIRMED,

    /** Frees the slot immediately: the exclusion constraint's WHERE clause stops matching. */
    CANCELLED,

    /** The appointment happened. Only reachable after {@code endsAt}. */
    COMPLETED,

    /** The customer did not turn up. Only reachable after {@code startsAt}. */
    NO_SHOW;

    /**
     * The two statuses that occupy a calendar, and the same pair as the {@code WHERE} clause of
     * the {@code booking_no_overlap} exclusion constraint. Defined once so the engine's query and
     * the database's guarantee cannot drift apart.
     */
    private static final Set<BookingStatus> BLOCKING = EnumSet.of(PENDING, CONFIRMED);

    public static Collection<BookingStatus> blocking() {
        return BLOCKING;
    }

    /** Whether a booking in this status still holds its slot. */
    public boolean isActive() {
        return BLOCKING.contains(this);
    }

    /** Nothing follows these except, for a no-show, an admin correction. */
    public boolean isTerminal() {
        return this == CANCELLED || this == COMPLETED;
    }
}
