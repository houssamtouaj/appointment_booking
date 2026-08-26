package com.slotflow.notification;

import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Turns a {@link NotificationRequest} into an actual send, after the transaction that asked for it
 * has committed.
 *
 * <p>This class is the whole reason the request is an event. {@code AFTER_COMMIT} means a rolled-back
 * invitation mails nothing at all, which is the property {@link NotificationService}'s javadoc
 * always described and no call site enforced: an invitation whose transaction fails after the send
 * leaves a working-looking link in an inbox for a user row that does not exist, and nothing for the
 * owner to resend from because there is nothing to resend.
 *
 * <p>{@code fallbackExecution = true} covers a publisher with no transaction at all — otherwise the
 * event would be dropped in silence, which is a worse failure than sending early. Nothing in the
 * application publishes outside a transaction today; a test or a future scheduled job might.
 *
 * <p>A failure in here can no longer roll anything back — the transaction is already committed —
 * but it would still reach the caller and become a 500 over a request that in fact succeeded. That
 * is not papered over with a {@code catch}, and it does not need to be: the implementation is
 * {@code @Async}, so a bounced SMTP connection is a retry on a worker thread and this method has
 * returned long before it happens. What is left to throw is a bug in composing the message, and an
 * owner who asked for an invitation is exactly the person who should hear that it did not go — they
 * are the one who can resend it. {@link BookingNotifier} makes the opposite call for the opposite
 * reason: a guest who has just booked cannot resend anything.
 */
@Component
class NotificationDispatcher {

    private final NotificationService notifications;

    NotificationDispatcher(NotificationService notifications) {
        this.notifications = notifications;
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void send(NotificationRequest request) {
        switch (request) {
            case NotificationRequest.PasswordReset reset -> notifications.sendPasswordReset(
                    reset.recipient(), reset.rawToken(), reset.expiresAt());
            case NotificationRequest.StaffInvitation invitation ->
                    notifications.sendStaffInvitation(invitation.recipient(),
                            invitation.businessName(), invitation.rawToken(),
                            invitation.expiresAt());
        }
    }
}
