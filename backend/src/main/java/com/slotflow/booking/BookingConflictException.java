package com.slotflow.booking;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * Somebody else took the slot. {@code 409 BOOKING_SLOT_TAKEN}, with the slot echoed back.
 *
 * <p>This is the exception the whole project points at. The availability check before the insert is
 * an optimisation and a source of good error messages; the guarantee is
 * {@code booking_no_overlap}, a GiST exclusion constraint over {@code [blocked_from, blocked_to)}
 * per staff member. Two requests racing for the same 10:00 produce one row and one {@code 23P01},
 * whatever either request believed a millisecond earlier.
 *
 * <h2>Matched by SQLState, never by name or message</h2>
 * {@link #isSlotOverlap} unwraps to {@link SQLException#getSQLState()} and compares it to
 * {@code 23P01}. The tempting spelling — {@code ex.getMessage().contains("booking_no_overlap")} —
 * works today and breaks the day somebody renames the constraint, on the one code path where
 * breaking means a {@code 500} instead of a {@code 409} on the busiest endpoint in the product.
 * Hibernate wraps the violation two or three levels deep (Spring's
 * {@link DataIntegrityViolationException} around Hibernate's {@code ConstraintViolationException}
 * around the driver's {@code PSQLException}), so the walk down the cause chain is not defensive
 * padding — the interesting exception is never the one that was caught.
 *
 * <h2>The slot travels in the body</h2>
 * A client that gets this has a stale calendar on screen. Echoing {@code startsAt}, {@code endsAt}
 * and {@code staffId} lets it grey out exactly that offer and refetch, instead of parsing prose or
 * reloading the whole month.
 */
public class BookingConflictException extends ApiException {

    /** SQLSTATE {@code exclusion_violation}. The only one this class claims. */
    private static final String EXCLUSION_VIOLATION = "23P01";

    public BookingConflictException(UUID staffId, Instant startsAt, Instant endsAt) {
        super(ErrorCode.BOOKING_SLOT_TAKEN,
                "That slot has just been taken. Refresh the availability and pick another.");
        with("staffId", staffId);
        with("startsAt", startsAt);
        with("endsAt", endsAt);
    }

    /**
     * Whether this violation is the exclusion constraint rather than some other broken invariant.
     *
     * <p>The distinction matters: {@code booking} also carries a unique cancellation token, a unique
     * Checkout session id and seven check constraints, and translating any of them into "that slot
     * is taken" would send a client into a refetch loop over a bug on our side. Anything that is not
     * {@code 23P01} is rethrown and becomes the generic {@code 409 DATA_CONFLICT} the advice logs.
     */
    public static boolean isSlotOverlap(DataIntegrityViolationException violation) {
        for (Throwable cause = violation; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql
                    && EXCLUSION_VIOLATION.equals(sql.getSQLState())) {
                return true;
            }
            if (cause.getCause() == cause) {
                // A self-referencing cause is pathological rather than impossible, and this loop
                // runs inside the failure path of the endpoint that must never hang.
                return false;
            }
        }
        return false;
    }
}
