package com.slotflow.notification;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The shape of the two links this stub builds, which is the only thing about it worth asserting.
 *
 * <p>It is also the reason the stub is not a no-op: the URLs it assembles are the routes the SPA
 * has to serve, so they are settled here in wave 3 rather than discovered in wave 7 when plan 12
 * replaces the class. That makes the shape a published decision, and a decision is worth a test.
 */
class LoggingNotificationServiceTest {

    private static final String BASE_URL = "https://app.slotflow.test";

    private final LoggingNotificationService notifications =
            new LoggingNotificationService(BASE_URL);

    @Test
    @DisplayName("the token is a path segment, never a query parameter")
    void tokensTravelInThePath() {
        String token = "OxedfiNOXWixf3de6KdNlaar75pnPBgOf5vUxcD9BmQ";

        // PublicInvitationController argues the token is a path segment specifically because a
        // query string leaks through Referer headers, browser history and analytics beacons — and
        // this is the one component that mints the URL, so a query parameter here reintroduces
        // exactly the threat the controller's contract was shaped around. A seven-day credential
        // and a one-hour one, both in a place the browser hands to third parties.
        assertThat(notifications.invitationLink(token))
                .isEqualTo(BASE_URL + "/accept-invitation/" + token)
                .doesNotContain("?");
        assertThat(notifications.passwordResetLink(token))
                .isEqualTo(BASE_URL + "/reset-password/" + token)
                .doesNotContain("?");
    }

    @Test
    @DisplayName("the segment is encoded rather than trusted to be URL-safe")
    void tokensAreEncoded() {
        // SecretTokens emits base64url, so today nothing needs escaping. Relying on that in the one
        // place a token becomes a URL is how a change of token format turns into a broken link, or
        // worse, a path that means something else.
        assertThat(notifications.invitationLink("a/b c?d"))
                .isEqualTo(BASE_URL + "/accept-invitation/a%2Fb%20c%3Fd");
    }

    @Test
    @DisplayName("a base URL with a trailing slash does not produce a double one")
    void theBaseUrlIsJoinedCleanly() {
        LoggingNotificationService trailing =
                new LoggingNotificationService(BASE_URL + "/");

        assertThat(trailing.invitationLink("token"))
                .isEqualTo(BASE_URL + "/accept-invitation/token");
    }
}
