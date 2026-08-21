package com.slotflow.staff;

import java.time.Instant;

/**
 * The result of a {@code PATCH /api/staff/{id}}: the updated record, plus a warning when the change
 * has consequences the owner cannot see from the form they just submitted.
 *
 * <p>The warning exists because of the deactivation rule (plan 06 step 3). Deactivating a staff
 * member blocks their login and hides them from the public list immediately, and <b>leaves their
 * future bookings intact</b> — visible in the admin calendar with a badge. Silently cancelling or
 * reassigning a real customer's appointment is worse than the awkward state, and doing it without
 * saying so is worse again. So the owner is told what is now booked to somebody who can no longer
 * log in, and decides what to do about it.
 *
 * @param warning null unless this call deactivated someone with upcoming bookings; Jackson omits it
 */
public record StaffUpdateResponse(StaffResponse staff, DeactivationWarning warning) {

    /**
     * @param upcomingBookings how many active bookings this person still has in the future
     * @param nextBookingAt    the first of them, so the message can name a date instead of a count
     */
    public record DeactivationWarning(long upcomingBookings, Instant nextBookingAt) {
    }
}
