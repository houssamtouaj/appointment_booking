package com.slotflow.notification;

import com.slotflow.notification.NotificationService.Recipient;
import java.time.Instant;

/**
 * What a service asks for when it wants something sent, published as an application event instead
 * of being handed straight to {@link NotificationService}.
 *
 * <p><b>The event is the after-commit boundary.</b> A service calling the notification service
 * directly sends from inside its own open transaction, and a commit that then fails — the
 * {@code app_user_email_key} race, a dropped connection, any later exception in the same request —
 * leaves a live-looking seven-day link in somebody's inbox for a row that never existed, and no row
 * for the owner to resend from. {@link NotificationDispatcher} listens {@code AFTER_COMMIT}, so a
 * message only ever describes something that is really there.
 *
 * <p>Publishing an event rather than registering a {@code TransactionSynchronization} at each call
 * site keeps the rule in one place. "Remember to defer this one too" is not a rule, it is a hope.
 *
 * <p><b>Bookings do not travel this way.</b> They publish {@code BookingEvent} and
 * {@link BookingNotifier} decides what each one means in an inbox, because a booking's consequences
 * are not all emails — plan 11 hangs a Checkout session off the same event. These two records are
 * the cases where the message <em>is</em> the event: nothing else in the system cares that somebody
 * asked for a password reset.
 *
 * <p>Sealed, so the dispatcher's {@code switch} is exhaustive: a third kind of message added here
 * without a branch there is a compile error rather than a message nobody receives.
 */
public sealed interface NotificationRequest {

    Recipient recipient();

    /** D6. The link is single-use and expires within the hour. */
    record PasswordReset(Recipient recipient, String rawToken, Instant expiresAt)
            implements NotificationRequest {
    }

    /** Plan 06. The link is where the invitee sets a name and a password and becomes active. */
    record StaffInvitation(Recipient recipient, String businessName, String rawToken,
            Instant expiresAt) implements NotificationRequest {
    }
}
