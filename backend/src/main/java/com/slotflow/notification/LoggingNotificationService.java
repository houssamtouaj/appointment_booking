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
 * from these lines. {@code LoggingNotificationServiceTest} pins that shape, because "settled" and
 * "whatever the stub happens to emit" are otherwise the same thing.
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
                passwordResetLink(rawToken));
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
                invitationLink(rawToken));
    }

    /** {@code {frontend}/accept-invitation/{token}} — see {@link #link}. */
    String invitationLink(String rawToken) {
        return link("/accept-invitation", rawToken);
    }

    /** {@code {frontend}/reset-password/{token}} — see {@link #link}. */
    String passwordResetLink(String rawToken) {
        return link("/reset-password", rawToken);
    }

    /**
     * <b>The token is a path segment, not a query parameter.</b> This is the one component that
     * mints these URLs, so it is the one place that can undo the reason
     * {@link com.slotflow.staff.PublicInvitationController} takes its token in the path: a query
     * string is handed to third parties. It travels in the {@code Referer} header of every asset the
     * page loads, it is kept verbatim in browser history and in synced-profile backups, and every
     * analytics beacon on the page reports the full URL including its query. A path segment goes to
     * none of those, and what is in this URL is a live credential — seven days for an invitation,
     * one hour for a reset.
     *
     * <p>It is encoded rather than trusted. {@link com.slotflow.security.SecretTokens} emits
     * base64url, so nothing needs escaping today; relying on that in the one place a secret becomes
     * a URL is how a change of token format turns into a broken link, or into a token containing a
     * slash that silently means a different route.
     *
     * <p><b>What this assumes of the SPA.</b> Two routes, {@code /accept-invitation/:token} and
     * {@code /reset-password/:token}, and both read the token from the path. Nothing serves them
     * yet — {@code frontend/} is still a scaffold — which is exactly why the shape is settled here:
     * plan 12 replaces this class, and by then the decision should already be made rather than
     * inherited from whatever the stub happened to build.
     */
    private String link(String path, String rawToken) {
        return UriComponentsBuilder.fromUriString(frontendBaseUrl)
                .path(path)
                .pathSegment(rawToken)
                .build()
                .encode()
                .toUriString();
    }
}
