package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.common.error.ErrorCode;
import java.sql.SQLException;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * The unwrap, on its own, with no database anywhere near it.
 *
 * <p>{@code ExclusionConstraintIT} proves Postgres refuses the overlap; this proves the application
 * recognises the refusal when it arrives wrapped in three layers of somebody else's exception. Both
 * are needed, and the second is the one that breaks silently: a translation that stops matching
 * turns the busiest 409 in the product into a 500, and no other test in the suite is looking at the
 * exception type.
 */
class BookingConflictExceptionTest {

    /** SQLSTATE {@code exclusion_violation}. */
    private static final String EXCLUSION_VIOLATION = "23P01";

    /** SQLSTATE {@code unique_violation}: a real conflict, and not this one. */
    private static final String UNIQUE_VIOLATION = "23505";

    @Test
    @DisplayName("the constraint violation is recognised three levels down, where Hibernate puts it")
    void unwrapsToTheSqlState() {
        // Spring's translator around Hibernate's own wrapper around the driver's exception, which
        // is the shape that actually arrives from saveAndFlush.
        DataIntegrityViolationException thrown = new DataIntegrityViolationException(
                "could not execute statement",
                new RuntimeException("ConstraintViolationException: booking_no_overlap",
                        new SQLException("conflicting key value violates exclusion constraint",
                                EXCLUSION_VIOLATION)));

        assertThat(BookingConflictException.isSlotOverlap(thrown)).isTrue();
    }

    @Test
    @DisplayName("a different constraint is not a taken slot, however similar the message reads")
    void doesNotClaimEveryIntegrityViolation() {
        // booking also has a unique cancellation token and a unique Checkout session id. Reporting
        // either as "somebody took your slot" would send a client into a refetch loop over a bug on
        // our side, which is why this matches the SQLState and not the word "booking".
        DataIntegrityViolationException unique = new DataIntegrityViolationException(
                "duplicate key value violates unique constraint booking_cancellation_token_key",
                new SQLException("duplicate key", UNIQUE_VIOLATION));

        assertThat(BookingConflictException.isSlotOverlap(unique)).isFalse();
        assertThat(BookingConflictException.isSlotOverlap(
                new DataIntegrityViolationException("no cause at all"))).isFalse();
    }

    @Test
    @DisplayName("a self-referencing cause chain terminates instead of hanging the request")
    void survivesACycle() {
        SQLException cyclic = new SQLException("odd", UNIQUE_VIOLATION) {
            @Override
            public synchronized Throwable getCause() {
                return this;
            }
        };
        assertThat(BookingConflictException.isSlotOverlap(
                new DataIntegrityViolationException("wrapped", cyclic))).isFalse();
    }

    @Test
    @DisplayName("the slot travels in the body, so a stale calendar knows which offer to retire")
    void carriesTheRequestedSlot() {
        UUID staffId = UUID.randomUUID();
        Instant startsAt = Instant.parse("2026-03-04T08:00:00Z");
        Instant endsAt = Instant.parse("2026-03-04T09:00:00Z");

        BookingConflictException conflict = new BookingConflictException(staffId, startsAt, endsAt);

        assertThat(conflict.code()).isEqualTo(ErrorCode.BOOKING_SLOT_TAKEN);
        assertThat(conflict.status().value()).isEqualTo(409);
        assertThat(conflict.properties())
                .containsEntry("staffId", staffId)
                .containsEntry("startsAt", startsAt)
                .containsEntry("endsAt", endsAt);
    }
}
