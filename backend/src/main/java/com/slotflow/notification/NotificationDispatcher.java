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
 * <p>There is no {@code catch} in here, and there is nothing for one to catch. The transaction has
 * already committed, so a throw could not roll anything back; it could only turn a request that in
 * fact succeeded into a 500. It cannot even do that: every {@link MailNotificationService} method is
 * {@code @Async}, so this method has returned before the message is composed, let alone sent, and
 * {@link EmailSender} logs a render failure and a twice-failed delivery against a reference rather
 * than throwing at all. {@code AsyncConfig}'s handler is the backstop for anything past that.
 *
 * <p><b>Which means a failed invitation is a log line and not an error the owner sees</b>, even
 * though the owner is the one who could resend it. That is the cost of sending after commit on a
 * worker thread, and the alternative is worse: a synchronous send makes a dead SMTP relay fail an
 * invitation that has already been created, and the owner retries into a duplicate. The reference in
 * every {@link EmailSender} log line is what makes the failure findable instead of invisible; a
 * durable outbox is the real answer, at a scale this project does not claim.
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
