package com.slotflow.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The shape of the three links every outbound message is built around.
 *
 * <p>These URLs are the routes the SPA has to serve, so they are a published decision rather than
 * whatever the code happens to emit — which is why they were settled in wave 3, against the logging
 * stub, and are asserted here now that both implementations mint them through one component.
 */
class FrontendLinksTest {

    private static final String BASE_URL = "https://app.slotflow.test";

    private final FrontendLinks links = new FrontendLinks(BASE_URL);

    @Test
    @DisplayName("the token is a path segment, never a query parameter")
    void tokensTravelInThePath() {
        String token = "OxedfiNOXWixf3de6KdNlaar75pnPBgOf5vUxcD9BmQ";
        UUID cancellationToken = UUID.fromString("7c4f2f1e-2f7a-4a2b-9c1e-1f0b8b1d2a33");

        // PublicInvitationController argues the token is a path segment specifically because a
        // query string leaks through Referer headers, browser history and analytics beacons — and
        // this is the one component that mints the URL, so a query parameter here reintroduces
        // exactly the threat the controller's contract was shaped around. A seven-day credential,
        // a one-hour one, and one that lives as long as the booking does, all in a place the
        // browser hands to third parties.
        assertThat(links.invitation(token))
                .isEqualTo(BASE_URL + "/accept-invitation/" + token)
                .doesNotContain("?");
        assertThat(links.passwordReset(token))
                .isEqualTo(BASE_URL + "/reset-password/" + token)
                .doesNotContain("?");
        assertThat(links.manageBooking(cancellationToken))
                .isEqualTo(BASE_URL + "/booking/" + cancellationToken)
                .doesNotContain("?");
    }

    @Test
    @DisplayName("the segment is encoded rather than trusted to be URL-safe")
    void tokensAreEncoded() {
        // SecretTokens emits base64url, so today nothing needs escaping. Relying on that in the one
        // place a token becomes a URL is how a change of token format turns into a broken link, or
        // worse, a path that means something else.
        assertThat(links.invitation("a/b c?d"))
                .isEqualTo(BASE_URL + "/accept-invitation/a%2Fb%20c%3Fd");
    }

    @Test
    @DisplayName("a base URL with a trailing slash does not produce a double one")
    void theBaseUrlIsJoinedCleanly() {
        FrontendLinks trailing = new FrontendLinks(BASE_URL + "/");

        assertThat(trailing.invitation("token")).isEqualTo(BASE_URL + "/accept-invitation/token");
    }
}
