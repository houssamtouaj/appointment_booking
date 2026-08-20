package com.slotflow.booking;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/**
 * Booking reads, with the queries later plans need already shaped.
 *
 * <p>The default methods are the point of this interface. Each one gives a plan-facing name to a
 * derived query and puts the status filter in exactly one place, so "active" cannot come to mean
 * something slightly different in the engine than it does in the database's exclusion constraint.
 */
public interface BookingRepository extends JpaRepository<Booking, UUID> {

    // ---------------------------------------------------------------------------------
    //  the engine's hot path
    // ---------------------------------------------------------------------------------

    /**
     * Every booking that occupies calendar time for any of these staff members, anywhere in the
     * range. <b>One query for the whole range and all staff</b> — the naive shape of this, a query
     * per staff member per day, is a thirty-fold N+1 across a month view and it is the difference
     * between a 200 ms availability response and a five-second one.
     *
     * <p>The overlap test is on the buffer-expanded window (D4) and is half-open on both sides:
     * {@code blockedFrom < to and blockedTo > from}, matching {@code tstzrange}'s default and the
     * exclusion constraint exactly. A booking ending precisely when the range starts does not
     * overlap it.
     */
    default List<Booking> findActiveForStaffBetween(
            Collection<UUID> staffIds, Instant from, Instant to) {
        // Hibernate can render an empty IN list, but the result is a query that can only return
        // nothing. Not asking is cheaper and says what is meant.
        return staffIds.isEmpty()
                ? List.of()
                : findOverlappingForStaff(staffIds, BookingStatus.blocking(), from, to);
    }

    @Query("""
            select b from Booking b
            where b.staffId in :staffIds
              and b.status in :statuses
              and b.blockedFrom < :to
              and b.blockedTo > :from
            order by b.blockedFrom
            """)
    List<Booking> findOverlappingForStaff(Collection<UUID> staffIds,
                                          Collection<BookingStatus> statuses,
                                          Instant from, Instant to);

    // ---------------------------------------------------------------------------------
    //  the customer's own booking
    // ---------------------------------------------------------------------------------

    /** The guest's only credential. Their view-and-cancel page is this lookup and nothing else. */
    Optional<Booking> findByCancellationToken(UUID cancellationToken);

    // ---------------------------------------------------------------------------------
    //  admin reads, always tenant-scoped
    // ---------------------------------------------------------------------------------

    Optional<Booking> findByIdAndBusinessId(UUID id, UUID businessId);

    /** Webhook idempotency (plan 11): one booking per Checkout session, so replay is harmless. */
    Optional<Booking> findByStripeSessionId(String stripeSessionId);

    /**
     * What a staff member still has on their calendar, used by plan 06 to warn an owner before
     * deactivating them.
     *
     * <p>Deactivation deliberately leaves these bookings alone: they belong to real customers who
     * agreed a time with a named person, and silently cancelling or reassigning them is worse than
     * the awkward state of an appointment held by someone who can no longer log in. So the owner is
     * told what they are about to strand, and decides.
     */
    default List<Booking> findUpcomingActiveForStaff(UUID staffId, Instant from) {
        return findByStaffIdAndStatusInAndStartsAtGreaterThanEqualOrderByStartsAtAsc(
                staffId, BookingStatus.blocking(), from);
    }

    List<Booking> findByStaffIdAndStatusInAndStartsAtGreaterThanEqualOrderByStartsAtAsc(
            UUID staffId, Collection<BookingStatus> statuses, Instant from);

    // ---------------------------------------------------------------------------------
    //  the scheduled jobs
    // ---------------------------------------------------------------------------------

    /**
     * Abandoned checkouts (D3). Without this sweep every abandoned Stripe session holds its slot
     * forever, because the exclusion constraint covers {@code PENDING} too.
     */
    default List<Booking> findExpiredPending(Instant now) {
        return findByStatusAndExpiresAtBefore(BookingStatus.PENDING, now);
    }

    List<Booking> findByStatusAndExpiresAtBefore(BookingStatus status, Instant expiresBefore);

    /**
     * Reminders due in the window, skipping anything already reminded (plan 12). The
     * {@code reminderSentAt IS NULL} half is what makes the job idempotent across restarts by
     * construction rather than by hoping it does not run twice.
     */
    default List<Booking> findDueReminders(Instant windowStart, Instant windowEnd) {
        return findByStatusAndReminderSentAtIsNullAndStartsAtBetween(
                BookingStatus.CONFIRMED, windowStart, windowEnd);
    }

    List<Booking> findByStatusAndReminderSentAtIsNullAndStartsAtBetween(
            BookingStatus status, Instant from, Instant to);
}
