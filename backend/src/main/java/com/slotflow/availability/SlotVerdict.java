package com.slotflow.availability;

import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * What the engine says about <em>one exact start</em>, which is the question plan 10 asks and the
 * slots endpoint cannot answer.
 *
 * <p>The list endpoint hands a customer a menu. The booking path needs something narrower and one
 * step more informative: not only "is this start on the menu" but "and if it is not, whose fault is
 * that" — because the answer decides between a {@code 409} the client should retry against fresh
 * availability and a {@code 422} that no amount of refetching will fix.
 *
 * <h2>Why the second list exists</h2>
 * {@link #availableStaff()} is the real answer, computed against the real calendar. {@link
 * #staffFreeOnAnEmptyCalendar()} is the same question asked of the same working hours, overrides and
 * policy window with every existing booking removed — the engine is a pure function, so this costs
 * a second fold over data already in memory and no extra query.
 *
 * <p>The difference between the two is exactly "another booking is in the way". That is what lets
 * the booking service answer {@code 409 BOOKING_SLOT_TAKEN} for a start the calendar would happily
 * have offered on a quiet day, and a specific {@code 422} for one it would never have offered at
 * all — the distinction the plan-10 gate draws, and one that a single "is it on the list" check
 * cannot make.
 *
 * @param anyCandidateStaff         whether anybody performs this service and can still be booked at
 *                                  all. It is not derivable from the two lists below — both are
 *                                  empty for a fully booked morning as well as for a service nobody
 *                                  has been assigned to, and those deserve different sentences
 * @param availableStaff            everyone who could serve this exact start right now, sorted.
 *                                  Empty means the start was not offered
 * @param staffFreeOnAnEmptyCalendar everyone who could have served it if nothing were booked
 * @param activeBookingsThatDay     how many calendar-holding bookings each candidate already has on
 *                                  the business-zone day this start falls in. The tie-break for an
 *                                  any-staff booking (plan 09): fewest first, then lowest id, so
 *                                  the work spreads instead of always landing on one person
 */
public record SlotVerdict(boolean anyCandidateStaff,
        List<UUID> availableStaff,
        List<UUID> staffFreeOnAnEmptyCalendar,
        Map<UUID, Long> activeBookingsThatDay) {

    public SlotVerdict {
        availableStaff = List.copyOf(availableStaff);
        staffFreeOnAnEmptyCalendar = List.copyOf(staffFreeOnAnEmptyCalendar);
        activeBookingsThatDay = Map.copyOf(activeBookingsThatDay);
    }

    /** Nobody performs the service at all, so there is nothing to ask the engine about. */
    public static SlotVerdict nobody() {
        return new SlotVerdict(false, List.of(), List.of(), Map.of());
    }

    public boolean isBookable() {
        return !availableStaff.isEmpty();
    }

    /**
     * True when the only thing standing between this request and a row is another booking — which
     * is a {@code 409}, not a {@code 422}, and is the same answer the exclusion constraint would
     * give a moment later.
     */
    public boolean isTakenByAnotherBooking() {
        return availableStaff.isEmpty() && !staffFreeOnAnEmptyCalendar.isEmpty();
    }

    /**
     * Who should take it: fewest bookings that day, then lowest id.
     *
     * <p>Deterministic on purpose. The engine deliberately refuses to choose (see {@code Slot}),
     * because choosing there would throw away the alternatives; choosing here spreads the load and
     * costs no extra query, since the counts came back with the bookings the engine already
     * subtracted.
     */
    public Optional<UUID> preferredStaff() {
        return availableStaff.stream().min(
                Comparator.<UUID>comparingLong(id -> activeBookingsThatDay.getOrDefault(id, 0L))
                        .thenComparing(Comparator.naturalOrder()));
    }
}
