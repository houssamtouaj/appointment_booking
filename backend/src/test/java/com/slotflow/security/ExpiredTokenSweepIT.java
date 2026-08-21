package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.support.ApiIntegrationTest;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The token sweep, which exists because nothing else ever deletes a refresh token.
 *
 * <p>The second assertion is the one worth the class. Sweeping is trivially correct if it deletes
 * expired rows and trivially a security regression if it also deletes revoked ones: a revoked token
 * inside its seven days is what turns a replay into {@code 401 REFRESH_REUSED} and a chain
 * revocation, and without the row the same replay is merely an unknown token.
 */
class ExpiredTokenSweepIT extends ApiIntegrationTest {

    @Autowired
    private ExpiredTokenSweeper sweeper;

    @Autowired
    private RefreshTokenService refreshTokens;

    @Autowired
    private PasswordResetService resetTokens;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("expired refresh and reset tokens are deleted; live ones are not")
    void expiredTokensAreSwept() {
        Tenant tenant = aTenant();
        UUID userId = tenant.owner().getId();
        String staleRefresh = refreshTokens.issueFor(userId).rawValue();
        String staleReset = resetTokens.issueFor(userId).rawValue();

        // Past the seven-day refresh lifetime and far past the one-hour reset one.
        clock.advanceBy(Duration.ofDays(8));
        String liveRefresh = refreshTokens.issueFor(userId).rawValue();
        String liveReset = resetTokens.issueFor(userId).rawValue();

        assertThat(sweeper.sweep()).isPositive();

        assertThat(refreshRows(staleRefresh)).isZero();
        assertThat(resetRows(staleReset)).isZero();
        assertThat(refreshRows(liveRefresh)).as("still usable, still here").isEqualTo(1);
        assertThat(resetRows(liveReset)).isEqualTo(1);
    }

    @Test
    @DisplayName("a revoked but unexpired token survives, because reuse detection reads it")
    void revokedTokensInsideTheirWindowAreKept() {
        Tenant tenant = aTenant();
        String presented = refreshTokens.issueFor(tenant.owner().getId()).rawValue();
        refreshTokens.rotate(presented);

        // Revoked a moment ago and expiring in seven days. Deleting it would turn the replay below
        // from "this session has been ended, and every other one too" into "unknown token" — the
        // theft signal the whole rotation chain exists for, swept away as housekeeping.
        sweeper.sweep();

        assertThat(refreshRows(presented)).isEqualTo(1);
        assertThat(jdbc.queryForObject(
                "SELECT revoked_at IS NOT NULL FROM refresh_token WHERE token_hash = ?",
                Boolean.class, SecretTokens.hash(presented)))
                .isTrue();
    }

    private int refreshRows(String rawToken) {
        return jdbc.queryForObject("SELECT count(*) FROM refresh_token WHERE token_hash = ?",
                Integer.class, SecretTokens.hash(rawToken));
    }

    private int resetRows(String rawToken) {
        return jdbc.queryForObject("SELECT count(*) FROM password_reset_token WHERE token_hash = ?",
                Integer.class, SecretTokens.hash(rawToken));
    }
}
