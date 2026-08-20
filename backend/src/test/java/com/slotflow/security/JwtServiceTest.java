package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.staff.Role;
import com.slotflow.staff.User;
import com.slotflow.support.MutableClock;
import java.time.Duration;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The access token, unit-tested: no Spring context, no database, and time under the test's control.
 *
 * <p>Everything here is about what the token refuses. Round-tripping claims is the easy half — the
 * assertions that matter are that a token signed with a different key is rejected, that expiry is
 * evaluated against the injected clock rather than the wall, and that every kind of failure produces
 * the same unhelpful {@code null}.
 */
class JwtServiceTest {

    private static final String SECRET = "unit-test-signing-key-thirty-two-plus-bytes";
    private static final String OTHER_SECRET = "a-completely-different-key-of-sufficient-length";

    private final MutableClock clock = MutableClock.startingAtTestTime();
    private final JwtService jwtService = serviceWith(SECRET, Duration.ofMinutes(15), clock);

    @Test
    @DisplayName("a token round-trips the three claims that authorise a request")
    void tokensCarryUserBusinessAndRole() {
        User owner = anOwner();

        AuthPrincipal principal = jwtService.parse(jwtService.issue(owner));

        assertThat(principal).isNotNull();
        assertThat(principal.userId()).isEqualTo(owner.getId());
        // The tenant boundary. Every admin query is scoped by this value and by nothing a caller
        // can put in a path.
        assertThat(principal.businessId()).isEqualTo(owner.getBusinessId());
        assertThat(principal.role()).isEqualTo(Role.OWNER);
        assertThat(principal.authority()).isEqualTo("ROLE_OWNER");
    }

    @Test
    @DisplayName("two tokens for the same user differ, because each carries its own jti")
    void tokensAreDistinct() {
        User owner = anOwner();

        assertThat(jwtService.issue(owner)).isNotEqualTo(jwtService.issue(owner));
    }

    @Test
    @DisplayName("a token is dead the moment its ttl elapses, measured on the injected clock")
    void expiryFollowsTheClock() {
        String token = jwtService.issue(anOwner());

        clock.advanceBy(Duration.ofMinutes(14));
        assertThat(jwtService.parse(token)).as("still inside the window").isNotNull();

        clock.advanceBy(Duration.ofMinutes(2));
        assertThat(jwtService.parse(token)).as("past it").isNull();
    }

    @Test
    @DisplayName("a token signed with another key is refused")
    void signaturesAreVerified() {
        String foreign = serviceWith(OTHER_SECRET, Duration.ofMinutes(15), clock).issue(anOwner());

        assertThat(jwtService.parse(foreign)).isNull();
    }

    @Test
    @DisplayName("an unsigned token with the right claims is refused")
    void unsignedTokensAreRefused() {
        // The classic alg=none attack: valid JSON, correct claims, no MAC. parseSignedClaims refuses
        // it because it is not a JWS at all, and this test is here so that never quietly changes.
        Base64.Encoder base64 = Base64.getUrlEncoder().withoutPadding();
        String header = base64.encodeToString("{\"alg\":\"none\"}".getBytes());
        String payload = base64.encodeToString(("{\"sub\":\"" + UUID.randomUUID()
                + "\",\"bid\":\"" + UUID.randomUUID() + "\",\"role\":\"OWNER\"}").getBytes());

        assertThat(jwtService.parse(header + "." + payload + ".")).isNull();
    }

    @Test
    @DisplayName("garbage, an empty string and a mangled signature all come back the same way")
    void everyFailureLooksIdentical() {
        String valid = jwtService.issue(anOwner());
        String mangled = valid.substring(0, valid.length() - 2) + "xy";

        assertThat(jwtService.parse("not-a-token")).isNull();
        assertThat(jwtService.parse("")).isNull();
        assertThat(jwtService.parse(mangled)).isNull();
    }

    @Test
    @DisplayName("the application refuses to start without a long enough secret")
    void shortSecretsFailFast() {
        // Fail at startup, not at the first login. An API that boots without a signing key and then
        // 500s on every authentication is strictly worse than one that will not boot.
        assertThatThrownBy(() -> serviceWith("too-short", Duration.ofMinutes(15), clock))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("needs at least 32");

        assertThatThrownBy(() -> serviceWith("", Duration.ofMinutes(15), clock))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("JWT_SECRET");
    }

    @Test
    @DisplayName("the configured ttl is what the token and the response body agree on")
    void ttlIsReadFromConfiguration() {
        JwtService fiveMinutes = serviceWith(SECRET, Duration.ofMinutes(5), clock);

        assertThat(fiveMinutes.accessTokenTtl()).isEqualTo(Duration.ofMinutes(5));

        String token = fiveMinutes.issue(anOwner());
        clock.advanceBy(Duration.ofMinutes(6));
        assertThat(fiveMinutes.parse(token)).isNull();
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private static JwtService serviceWith(String secret, Duration ttl, MutableClock clock) {
        AuthProperties properties = new AuthProperties(
                new AuthProperties.Jwt(secret, ttl, Duration.ofDays(7)),
                new AuthProperties.RefreshCookie(false, "Lax"),
                Duration.ofHours(1), Duration.ofDays(7), 4);
        return new JwtService(properties, clock);
    }

    private static User anOwner() {
        return User.owner(UUID.randomUUID(), "dana@example.test", "Dana Okoye", "$2a$04$hash");
    }
}
