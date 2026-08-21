package com.slotflow.notification;

import java.time.Instant;

/**
 * Everything this application sends to a human, behind one interface.
 *
 * <p><b>Plan 12 owns the implementation; wave 3 ships a logging stub.</b> The interface exists now
 * so that the two flows that need mail — a password reset and a staff invitation — depend on this
 * type and never on JavaMail, Thymeleaf or an SMTP host. When plan 12 lands, a second
 * implementation replaces {@link LoggingNotificationService} and no caller changes. Until then the
 * links are read from the application log, which is exactly what the wave-3 exit demo does.
 *
 * <p><b>The raw token is a parameter, and the link is built here.</b> That is the boundary that
 * matters: a service that creates an invitation knows the token but has no business knowing the
 * SPA's URL structure, and the notification layer knows the URLs but must never be able to mint a
 * token. Neither half can do the other's job by accident.
 *
 * <p><b>Nothing calls these methods directly.</b> A service publishes a {@link NotificationRequest}
 * and {@link NotificationDispatcher} calls the implementation {@code AFTER_COMMIT}, which is what
 * makes "a mail failure must not roll back a committed invitation" true in both directions: the mail
 * cannot undo the row, and a row that never committed cannot produce a mail. Sending from inside the
 * caller's transaction — which is what the two call sites used to do — meant a commit that failed
 * afterwards left a live-looking seven-day link in an inbox for a user that does not exist. The stub
 * cannot fail, so that stayed invisible; a real transport in plan 12 would have found it in
 * production.
 *
 * <p>Plan 12 also makes the send {@code @Async}, which is the other half: after-commit keeps the
 * message honest, off-thread keeps a slow SMTP handshake out of the request.
 */
public interface NotificationService {

    /**
     * Who the message is for. A record rather than the {@code User} entity, so the notification
     * layer cannot reach a password hash, a role or a tenant id it has no use for.
     */
    record Recipient(String email, String fullName) {
    }

    /** D6. The link is single-use and expires within the hour. */
    void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt);

    /** Plan 06. The link is where the invitee sets a name and a password and becomes active. */
    void sendStaffInvitation(Recipient recipient, String businessName,
                             String rawToken, Instant expiresAt);
}
