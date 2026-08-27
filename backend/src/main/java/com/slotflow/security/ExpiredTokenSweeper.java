package com.slotflow.security;

import java.time.Clock;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes refresh tokens and password-reset tokens that have expired.
 *
 * <p>The two bulk deletes this calls were written with a long argument for why a cleanup job wants
 * them, and no job called either. That is the worst of the three possible states: the cost is paid
 * (two queries nobody exercises, on the largest table in the schema) and the benefit is not.
 *
 * <h2>Why the table needs sweeping at all</h2>
 * {@code refresh_token} gains a row on every login <em>and</em> on every rotation, and rotation
 * happens every fifteen minutes for every signed-in tab. Nothing has ever deleted one. A single
 * active user is roughly a hundred rows a day, forever, on a table whose only queries are by hash
 * and by user — both indexed, so the pain arrives as storage, vacuum time and backup size rather
 * than as a slow endpoint, which is exactly the kind of growth nobody notices until it is large.
 *
 * <h2>By expiry, never by revocation</h2>
 * This is the load-bearing detail. A <em>revoked</em> token that has not yet expired is what reuse
 * detection reads: presenting it has to produce {@code 401 REFRESH_REUSED} and revoke the chain, and
 * that answer exists only while the row does. Delete revoked rows and a replayed token becomes an
 * unknown one — {@code 401 UNAUTHENTICATED}, no chain revocation, no theft signal — which is a
 * security regression dressed as housekeeping. An expired row, by contrast, can no longer be
 * presented successfully by anyone, so it proves nothing worth keeping.
 *
 * <h2>The schedule</h2>
 * Daily, off-peak, from {@code app.security.token-sweep-cron}. Set it to {@code -} to disable the
 * job entirely — which is what the test suite does, because a sweep firing in the middle of a suite
 * that moves the clock forward eight days would delete rows a test is about to assert on. The cron
 * is read straight from the environment rather than through {@link AuthProperties}: {@code @Scheduled}
 * needs a placeholder it can resolve at bean-definition time, which a record component is not.
 *
 * <p>Deliberately not sharded, batched or throttled. One statement per table against an indexed
 * predicate, once a day, on a single-instance deployment; two instances would run it twice, which is
 * idempotent. If this ever needs a {@code LIMIT} and a loop, that is a real change with a real
 * reason, and it should arrive with the number that forced it.
 */
@Component
public class ExpiredTokenSweeper {

    private static final Logger log = LoggerFactory.getLogger(ExpiredTokenSweeper.class);

    private final RefreshTokenRepository refreshTokens;
    private final PasswordResetTokenRepository resetTokens;
    private final Clock clock;

    public ExpiredTokenSweeper(RefreshTokenRepository refreshTokens,
            PasswordResetTokenRepository resetTokens, Clock clock) {
        this.refreshTokens = refreshTokens;
        this.resetTokens = resetTokens;
        this.clock = clock;
    }

    /**
     * @return how many rows went, which is what the log line and the test want
     */
    @Scheduled(cron = "${app.security.token-sweep-cron}")
    public int sweep() {
        Instant cutoff = clock.instant();
        int refreshed = refreshTokens.deleteByExpiresAtBefore(cutoff);
        int resets = resetTokens.deleteByExpiresAtBefore(cutoff);
        int total = refreshed + resets;
        if (total > 0) {
            log.info("Swept {} expired refresh token(s) and {} expired reset token(s) before {}",
                    refreshed, resets, cutoff);
        }
        return total;
    }
}
