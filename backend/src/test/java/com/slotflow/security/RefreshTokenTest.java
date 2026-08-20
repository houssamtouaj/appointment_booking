package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Rotation and the theft signal.
 *
 * <p>The chain is the whole point. A stolen refresh token is worth exactly one use, because using
 * it leaves a successor behind, and the next presentation of the stolen value is then provably a
 * replay — which is what plan 05 turns into {@code 401 REFRESH_REUSED} plus a full revocation of
 * the user's tokens.
 */
class RefreshTokenTest {

    private static final Instant NOW = Instant.parse("2026-03-02T09:00:00Z");
    private static final Clock CLOCK = Clock.fixed(NOW, ZoneOffset.UTC);

    private static final UUID USER_ID = UUID.randomUUID();

    @Test
    @DisplayName("a fresh token is valid, unrevoked and has no successor")
    void freshTokenIsValid() {
        RefreshToken token = token();

        assertThat(token.isValid(CLOCK.instant())).isTrue();
        assertThat(token.isRevoked()).isFalse();
        assertThat(token.hasSuccessor()).isFalse();
    }

    @Test
    @DisplayName("expiry is exact: valid up to the instant, not on it")
    void expiryBoundary() {
        RefreshToken token = token();
        Instant expiry = token.getExpiresAt();

        assertThat(token.isValid(expiry.minusSeconds(1))).isTrue();
        assertThat(token.isValid(expiry)).isFalse();
        assertThat(token.isExpired(expiry)).isTrue();
    }

    @Test
    @DisplayName("rotation revokes the old token and links it to its successor, in one step")
    void rotationRevokesAndLinks() {
        RefreshToken original = token();

        RefreshToken successor = original.rotate("newhash", NOW.plus(7, ChronoUnit.DAYS), NOW);

        // Both halves of the swap, because a rotation that revokes without linking loses the
        // theft signal, and one that links without revoking leaves two live tokens.
        assertThat(original.isRevoked()).isTrue();
        assertThat(original.getRevokedAt()).isEqualTo(NOW);
        assertThat(original.hasSuccessor()).isTrue();
        assertThat(original.getReplacedBy()).isEqualTo(successor.getId());
        assertThat(original.isValid(NOW)).isFalse();

        assertThat(successor.getUserId()).isEqualTo(USER_ID);
        assertThat(successor.isValid(NOW)).isTrue();
        assertThat(successor.hasSuccessor()).isFalse();
    }

    @Test
    @DisplayName("presenting an already-rotated token is detectable, which is the theft signal")
    void replayIsDetectable() {
        RefreshToken original = token();
        original.rotate("newhash", NOW.plus(7, ChronoUnit.DAYS), NOW);

        // This is exactly the state plan 05 inspects: revoked and carrying a successor. Revoked
        // alone would only mean "logged out"; the successor is what says somebody used it.
        assertThat(original.isRevoked()).isTrue();
        assertThat(original.hasSuccessor()).isTrue();
    }

    @Test
    @DisplayName("a revoked token cannot be rotated again")
    void revokedTokensCannotRotate() {
        RefreshToken token = token();
        token.revoke(NOW);

        assertThatThrownBy(() -> token.rotate("newhash", NOW.plus(7, ChronoUnit.DAYS), NOW))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("revoking twice keeps the first revocation time")
    void revocationIsIdempotent() {
        RefreshToken token = token();
        token.revoke(NOW);

        token.revoke(NOW.plus(1, ChronoUnit.HOURS));

        // Logout after logout is not an error, but the audit trail should say when the session
        // actually ended, not when someone last clicked the button.
        assertThat(token.getRevokedAt()).isEqualTo(NOW);
    }

    private static RefreshToken token() {
        return new RefreshToken(USER_ID, "a".repeat(64), NOW.plus(7, ChronoUnit.DAYS));
    }
}
