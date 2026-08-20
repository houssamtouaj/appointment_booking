package com.slotflow.booking;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;

/**
 * Thrown by {@link Booking} when a requested status change is not in the transition matrix, or is
 * in it but too early.
 *
 * <p>It is an {@link ApiException} so the advice turns it into {@code 409 ILLEGAL_TRANSITION}
 * without a dedicated handler, and both states travel as members of the problem body — a client
 * that optimistically flipped a badge needs to know what the server thinks the status is, not
 * only that it said no.
 *
 * <p>Raised from the entity rather than from a service, deliberately. The matrix is an invariant
 * of a booking, not a rule of one endpoint: the sweeper, the Stripe webhook and the admin
 * {@code PATCH} all mutate the same row, and a guard living in one of them protects only that one.
 */
public class IllegalBookingTransitionException extends ApiException {

    public IllegalBookingTransitionException(BookingStatus from, BookingStatus to, String reason) {
        super(ErrorCode.ILLEGAL_TRANSITION,
                "A %s booking cannot become %s: %s".formatted(from, to, reason));
        with("from", from.name());
        with("to", to.name());
    }
}
