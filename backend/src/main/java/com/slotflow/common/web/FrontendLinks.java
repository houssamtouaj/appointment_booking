package com.slotflow.common.web;

import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * The only component in this application that turns a secret into a URL.
 *
 * <p>It is one class rather than a helper on each implementation because both of them mint the same
 * three links, and a second copy is how the SPA ends up with two route shapes to support. The
 * routes it assumes — {@code /accept-invitation/:token}, {@code /reset-password/:token} and
 * {@code /booking/:token} — are the frontend's published contract, and
 * {@code NotificationLinksTest} pins them, because "settled" and "whatever the code happens to
 * emit" are otherwise the same thing.
 *
 * <h2>The token is a path segment, not a query parameter</h2>
 * A query string is handed to third parties. It travels in the {@code Referer} header of every
 * asset the page loads, it is kept verbatim in browser history and in synced-profile backups, and
 * every analytics beacon on the page reports the full URL including its query. A path segment goes
 * to none of those, and what is in these URLs is a live credential — seven days for an invitation,
 * one hour for a reset, and for the life of the booking for a cancellation token, which is never
 * reissued.
 *
 * <p>It is encoded rather than trusted. {@link com.slotflow.security.SecretTokens} emits base64url
 * and a cancellation token is a UUID, so nothing needs escaping today; relying on that in the one
 * place a secret becomes a URL is how a change of token format turns into a broken link, or into a
 * token containing a slash that silently means a different route.
 */
@Component
public class FrontendLinks {

    private final String frontendBaseUrl;

    public FrontendLinks(@Value("${app.frontend.base-url}") String frontendBaseUrl) {
        this.frontendBaseUrl = frontendBaseUrl;
    }

    /** {@code {frontend}/accept-invitation/{token}} — plan 06, seven days. */
    public String invitation(String rawToken) {
        return link("/accept-invitation", rawToken);
    }

    /** {@code {frontend}/reset-password/{token}} — D6, one hour, single use. */
    public String passwordReset(String rawToken) {
        return link("/reset-password", rawToken);
    }

    /**
     * {@code {frontend}/booking/{cancellationToken}} — the manage page.
     *
     * <p>This one goes in every customer-facing email, which is what makes the cancellation token's
     * "never reissued" property load-bearing rather than a detail: the link in an inbox from three
     * weeks ago has to still work, because it is the only way that customer can reach their own
     * booking (D1 — there is no account to log in to).
     */
    public String manageBooking(UUID cancellationToken) {
        return link("/booking", cancellationToken.toString());
    }

    private String link(String path, String rawToken) {
        return UriComponentsBuilder.fromUriString(frontendBaseUrl)
                .path(path)
                .pathSegment(rawToken)
                .build()
                .encode()
                .toUriString();
    }
}
