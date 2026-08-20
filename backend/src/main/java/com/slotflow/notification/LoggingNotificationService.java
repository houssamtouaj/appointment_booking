package com.slotflow.notification;

import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * The wave-3 stand-in for plan 12: it builds the real link and writes it to the log.
 *
 * <p>Not a no-op, and that distinction is the point. The link is assembled exactly as the mail will
 * assemble it, so the URL shape the SPA has to route is settled now rather than in wave 7, and the
 * invite-and-accept flow is demonstrable end to end today — the exit demo takes the accept link
 * from these lines.
 *
 * <p>It logs at {@code INFO} with the token in it, which would be indefensible in production and is
 * correct here: there is no mail transport yet, so the alternative is a flow nobody can complete.
 * Plan 12 deletes this class rather than editing it.
 */
@Service
public class LoggingNotificationService implements NotificationService {

    private static final Logger log = LoggerFactory.getLogger(LoggingNotificationService.class);

    private final String frontendBaseUrl;

    public LoggingNotificationService(@Value("${app.frontend.base-url}") String frontendBaseUrl) {
        this.frontendBaseUrl = frontendBaseUrl;
    }

    @Override
    public void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt) {
        log.info("""

                        --- password reset (no mail transport until plan 12) --------------------
                        to      : {} <{}>
                        expires : {}
                        link    : {}
                        ------------------------------------------------------------------------""",
                recipient.fullName(), recipient.email(), expiresAt,
                link("/reset-password", rawToken));
    }

    @Override
    public void sendStaffInvitation(Recipient recipient, String businessName,
                                    String rawToken, Instant expiresAt) {
        log.info("""

                        --- staff invitation (no mail transport until plan 12) ------------------
                        to      : {} <{}>
                        business: {}
                        expires : {}
                        link    : {}
                        ------------------------------------------------------------------------""",
                recipient.fullName(), recipient.email(), businessName, expiresAt,
                link("/accept-invitation", rawToken));
    }

    /**
     * The token goes in a query parameter rather than a path segment, and encoded: it is base64url,
     * so it is URL-safe by construction, but relying on that in the one place a token is put into a
     * URL is how a future change to the token format becomes a broken link.
     */
    private String link(String path, String rawToken) {
        return UriComponentsBuilder.fromUriString(frontendBaseUrl)
                .path(path)
                .queryParam("token", rawToken)
                .build()
                .toUriString();
    }
}
