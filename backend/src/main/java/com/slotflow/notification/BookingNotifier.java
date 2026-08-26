package com.slotflow.notification;

import com.slotflow.booking.BookingEvent;
import com.slotflow.notification.NotificationService.CancelledBy;
import java.util.UUID;
import java.util.function.Consumer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * The one place that decides which email a booking event means.
 *
 * <h2>The D10 rule, expressed as a switch</h2>
 * A booking that takes a deposit sends <em>received</em> then <em>confirmed</em>; one that does not
 * sends <em>confirmed</em> and nothing else. That is enforced by the shape of the events rather
 * than by a status check here: {@code Created} carries {@code awaitingDeposit} and picks one of the
 * two, and {@code Confirmed} is published only by the Stripe webhook. There is no path on which a
 * booking can produce two confirmations, because there is no path on which two branches of this
 * switch see the same booking in the same state.
 *
 * <h2>After commit, then off-thread, in that order</h2>
 * This listener runs on the request thread once the booking's transaction has committed, so a
 * rolled-back booking mails nothing at all — the property {@code BookingEvent} was introduced a
 * wave early to guarantee. It then does its reads (four small queries) and hands the result to
 * {@link NotificationService}, whose implementation is {@code @Async}. So the request pays for the
 * reads and never for the SMTP handshake, which is the split that keeps a dead relay from turning a
 * successful booking into a {@code 500}.
 *
 * <h2>Nothing here may throw</h2>
 * By the time this runs the row is durable and the customer's booking exists. An exception escaping
 * an after-commit listener propagates to the caller and becomes a {@code 500} over a request that
 * in fact succeeded — telling a customer their booking failed when it did not, which is a worse
 * outcome than a missing email by a wide margin. So every failure is caught and logged with the
 * booking id, and that log line is the alert.
 *
 * <p>That is a deliberate departure from {@link NotificationDispatcher}, which lets its failures
 * through. The difference is what the caller is told: a failed invitation is worth surfacing to the
 * owner who asked for it, because they can resend it. A guest who has just booked cannot resend
 * anything and has no use for the error.
 */
@Component
class BookingNotifier {

    private static final Logger log = LoggerFactory.getLogger(BookingNotifier.class);

    private final BookingNotificationFactory notifications;
    private final NotificationService mail;

    BookingNotifier(BookingNotificationFactory notifications, NotificationService mail) {
        this.notifications = notifications;
        this.mail = mail;
    }

    /**
     * {@code fallbackExecution = true} for the same reason every other listener in this codebase
     * sets it: a publisher with no transaction at all would otherwise have its event dropped in
     * silence, which is a worse failure than delivering early.
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void on(BookingEvent event) {
        switch (event) {
            case BookingEvent.Created created -> send(created.bookingId(),
                    created.awaitingDeposit() ? mail::sendBookingReceived : mail::sendBookingConfirmed);
            case BookingEvent.Confirmed confirmed ->
                    send(confirmed.bookingId(), mail::sendBookingConfirmed);
            case BookingEvent.Cancelled cancelled -> send(cancelled.bookingId(),
                    booking -> mail.sendBookingCancelled(booking, who(cancelled.source())));
        }
    }

    private void send(UUID bookingId, Consumer<BookingNotification> send) {
        try {
            notifications.forBooking(bookingId).ifPresentOrElse(send,
                    () -> log.warn("Booking {} vanished before it could be notified", bookingId));
        } catch (RuntimeException notified) {
            // See the class note: this cannot be allowed to reach the request.
            log.error("Could not notify anybody about booking {}", bookingId, notified);
        }
    }

    /**
     * The domain's word for who cancelled, translated into the notification layer's.
     *
     * <p>Two enums for one concept looks like duplication and is a boundary: this layer takes no
     * domain types, so a fourth cancellation source in {@code BookingEvent} is a compile error here
     * rather than a customer receiving the wrong apology. The names differ where the audiences do —
     * {@code STAFF} is who pressed the button, {@code BUSINESS} is who the customer thinks
     * cancelled.
     */
    private static CancelledBy who(BookingEvent.Cancelled.Source source) {
        return switch (source) {
            case GUEST -> CancelledBy.GUEST;
            case STAFF -> CancelledBy.BUSINESS;
            case EXPIRY -> CancelledBy.EXPIRY;
        };
    }
}
