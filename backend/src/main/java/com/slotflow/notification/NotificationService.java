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
 * <p>Every method is fire-and-forget from the caller's point of view. A mail failure must not roll
 * back a committed invitation — plan 12 makes these {@code @Async} and sends after commit; the
 * stub simply cannot fail.
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
