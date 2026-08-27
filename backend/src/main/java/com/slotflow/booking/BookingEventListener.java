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
 * <p>Plan 12's mail went into a second listener beside this one,
 * {@code com.slotflow.notification.BookingNotifier}, rather than into this method. Two subscribers
 * on the same phase rather than one that does two jobs: a mail failure must not be able to stop a
 * log line, and the notification layer has to reach four repositories this package has no reason to
 * know about. What both share is the phase — never back inside {@code PublicBookingService}, where
 * they would run before the row is durable.
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
        case BookingEvent.Confirmed confirmed -> log.info(
                "Booking {} confirmed by a deposit of {} minor units",
                confirmed.bookingId(), confirmed.depositPaidCents());
        case BookingEvent.Cancelled cancelled -> log.info(
                "Booking {} cancelled by {} at {}",
                cancelled.bookingId(), cancelled.source(), cancelled.at());
        }
    }
}
