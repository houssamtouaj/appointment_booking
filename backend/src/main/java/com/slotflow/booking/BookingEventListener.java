package com.slotflow.booking;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * The far side of the after-commit boundary, and for now the only side that does anything.
 *
 * <p>It logs. That is not a placeholder apology — it is what makes the boundary itself testable
 * this wave, before there is a Stripe call or an email to hang off it. {@code BookingEventIT} books
 * a slot, forces the transaction to roll back, and asserts nothing arrives here; without a
 * subscriber there would be nothing to assert and the wiring would go in untested, which is exactly
 * how the retrofit this class exists to avoid gets skipped.
 *
 * <p>{@code fallbackExecution = true} for the same reason {@code NotificationDispatcher} sets it: a
 * publisher with no transaction at all would otherwise have its event dropped in silence, which is
 * a worse failure than delivering early. Nothing in the application publishes outside a transaction
 * today; a test or a future scheduled job might.
 *
 * <p>Plan 11 adds the Checkout session on {@link BookingEvent.Created} when a deposit is owed, and
 * plan 12 adds the two confirmation emails (D10) and the cancellation notice. Both go here, or in a
 * second listener beside it — never back inside {@code PublicBookingService}, where they would run
 * before the row is durable.
 */
@Component
class BookingEventListener {

    private static final Logger log = LoggerFactory.getLogger(BookingEventListener.class);

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void on(BookingEvent event) {
        switch (event) {
            case BookingEvent.Created created -> log.info(
                    "Booking {} created in business {}{}",
                    created.bookingId(), created.businessId(),
                    created.awaitingDeposit() ? " awaiting a deposit" : "");
            case BookingEvent.Cancelled cancelled -> log.info(
                    "Booking {} cancelled by {} at {}",
                    cancelled.bookingId(), cancelled.source(), cancelled.at());
        }
    }
}
