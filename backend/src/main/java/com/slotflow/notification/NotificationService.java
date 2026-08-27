package com.slotflow.notification;

import java.time.Instant;

/**
 * Everything this application sends to a human, behind one interface.
 *
 * <p><b>Two implementations, one switch.</b> {@link MailNotificationService} renders Thymeleaf and
 * hands the result to SMTP; {@link LoggingNotificationService} writes the same links to the log and
 * is what {@code app.mail.enabled=false} selects — the demo profile, and any environment where a
 * dead mail relay must not be able to take a feature down. Exactly one of them is a bean, so there
 * is nothing to disambiguate and no way to have neither.
 *
 * <p><b>The raw token is a parameter, and the link is built here.</b> That is the boundary that
 * matters: a service that creates an invitation knows the token but has no business knowing the
 * SPA's URL structure, and the notification layer knows the URLs but must never be able to mint a
 * token. Neither half can do the other's job by accident. {@code FrontendLinks} is the single
 * place that turns one into the other.
 *
 * <p><b>Nothing calls these methods directly.</b> Two mechanisms feed them, and the split is
 * deliberate:
 *
 * <ul>
 *   <li>The two token flows publish a {@link NotificationRequest} and
 *       {@link NotificationDispatcher} calls this interface {@code AFTER_COMMIT}. There is no
 *       domain event for "a password reset was requested" — the message <em>is</em> the event.</li>
 *   <li>Bookings publish {@code BookingEvent}, and {@link BookingNotifier} listens on the same
 *       phase, loads what a template needs and calls the four booking methods below. A booking's
 *       consequences are not all emails — plan 11 hangs a Checkout session off the same event —
 *       so the domain event says what happened and this layer decides what that means in an
 *       inbox.</li>
 * </ul>
 *
 * <p>Either way the send is after commit and {@code @Async}: after-commit keeps the message honest
 * (a rolled-back booking mails nothing), off-thread keeps a slow SMTP handshake out of the request.
 * A dead relay must never turn a successful booking into a {@code 500}.
 */
public interface NotificationService {

    /**
     * Who the message is for. A record rather than the {@code User} entity, so the notification
     * layer cannot reach a password hash, a role or a tenant id it has no use for.
     */
    record Recipient(String email, String fullName) {
    }

    /**
     * Who ended a booking, because the three callers owe the customer different sentences: a
     * customer cancelling gets an acknowledgement, a business cancelling owes an apology, and an
     * expired deposit hold is a slot released to somebody who has already walked away.
     *
     * <p>Deliberately not {@code BookingEvent.Cancelled.Source}: this layer takes no domain types,
     * for the same reason {@link Recipient} is not a {@code User}. {@link BookingNotifier} maps
     * between them in one place, and a new source there is a compile error here.
     */
    enum CancelledBy {
        /** The manage page, with the cancellation token, inside the cutoff. */
        GUEST,
        /** Staff, through the admin API. The business can always cancel. */
        BUSINESS,
        /** The sweeper (D3): a deposit that never arrived. */
        EXPIRY
    }

    // ---------------------------------------------------------------------------------
    //  identity (plans 05, 06)
    // ---------------------------------------------------------------------------------

    /** D6. The link is single-use and expires within the hour. */
    void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt);

    /** Plan 06. The link is where the invitee sets a name and a password and becomes active. */
    void sendStaffInvitation(Recipient recipient, String businessName,
            String rawToken, Instant expiresAt);

    // ---------------------------------------------------------------------------------
    //  bookings (plan 12)
    // ---------------------------------------------------------------------------------

    /**
     * D10, first half: the booking exists but a deposit is outstanding, so the slot is held rather
     * than booked. Says how long the hold lasts and carries the pay link.
     *
     * <p>The pair with {@link #sendBookingConfirmed} is the reason these are two methods and not
     * one with a status on it. A booking that takes a deposit produces exactly two messages, in
     * this order; one that does not produces exactly one, and it is the second.
     */
    void sendBookingReceived(BookingNotification booking);

    /** D10, second half. The one with the {@code .ics} attachment. */
    void sendBookingConfirmed(BookingNotification booking);

    /** Includes who cancelled and the non-refundable note (D7). */
    void sendBookingCancelled(BookingNotification booking, CancelledBy cancelledBy);

    /** 24 hours before the start, once, ever — see {@code BookingReminderJob}. */
    void sendBookingReminder(BookingNotification booking);
}
