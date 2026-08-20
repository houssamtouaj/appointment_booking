package com.slotflow.security;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Rotation with reuse detection — the part of this plan worth reading twice.
 *
 * <h2>Rotation</h2>
 * Every successful refresh revokes the presented token, issues a successor and links the two
 * through {@code replaced_by}. A refresh token is therefore usable exactly once, and the chain of
 * links is a session's history.
 *
 * <h2>Reuse detection</h2>
 * That chain is what makes theft visible. A token that is already revoked — because it was rotated,
 * or because the user logged out — can only be presented by someone who kept a copy: the
 * legitimate client moved on to the successor and threw the old value away. So a replay is not
 * answered with a plain 401. It revokes <b>every live token for that user</b> and returns
 * {@code 401 REFRESH_REUSED}.
 *
 * <p>The consequence is deliberate and worth stating plainly. An attacker who steals a refresh
 * token gets at most one use of it, and the moment either party refreshes again both are logged
 * out — the victim notices, which is the whole point. The false-positive case is a client that
 * retries a refresh after a dropped response; it is logged out and logs back in, which is a much
 * better failure than a silently shared session.
 */
@Service
public class RefreshTokenService {

    private static final Logger log = LoggerFactory.getLogger(RefreshTokenService.class);

    private final RefreshTokenRepository refreshTokens;
    private final Duration ttl;
    private final Clock clock;

    /**
     * The theft response has to survive the exception that reports it.
     *
     * <p>Revoking the chain and then throwing {@code REFRESH_REUSED} inside the caller's
     * transaction would roll the revocation back with the response — the API would say "this
     * session has been ended" and end nothing. This template runs that one write in its own
     * transaction, which commits before the exception is thrown. It is a {@code TransactionTemplate}
     * rather than a second {@code @Transactional(REQUIRES_NEW)} method because the call is a
     * self-invocation, and a self-invocation does not pass through the proxy: the annotation would
     * be silently ignored and the bug would look exactly like no bug at all.
     */
    private final TransactionTemplate ownTransaction;

    public RefreshTokenService(RefreshTokenRepository refreshTokens, AuthProperties properties,
                              Clock clock, PlatformTransactionManager transactionManager) {
        this.refreshTokens = refreshTokens;
        this.ttl = properties.jwt().refreshTokenTtl();
        this.clock = clock;
        this.ownTransaction = new TransactionTemplate(transactionManager);
        this.ownTransaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    public Duration ttl() {
        return ttl;
    }

    /**
     * @param rawValue the value to hand to the client; it is not recoverable from anywhere else
     */
    public record Issued(String rawValue, Instant expiresAt) {
    }

    /** The result of a rotation: who it belongs to, and the successor to hand back. */
    public record Rotation(UUID userId, Issued successor) {
    }

    @Transactional
    public Issued issueFor(UUID userId) {
        String rawValue = SecretTokens.random();
        Instant expiresAt = clock.instant().plus(ttl);
        refreshTokens.save(new RefreshToken(userId, SecretTokens.hash(rawValue), expiresAt));
        return new Issued(rawValue, expiresAt);
    }

    /**
     * Consumes a refresh token and issues its successor.
     *
     * @throws ApiException {@code 401 REFRESH_REUSED} when the presented token was already
     *                      revoked, having first revoked everything else that user holds;
     *                      {@code 401 UNAUTHENTICATED} when it is unknown or expired
     */
    @Transactional
    public Rotation rotate(String rawToken) {
        RefreshToken presented = load(rawToken);

        if (presented.isRevoked() || presented.hasSuccessor()) {
            // The interesting branch. Note the order: revoke first, then throw, and both inside
            // this transaction — an attacker must not be able to win a race by refreshing twice.
            int revoked = ownTransaction.execute(status -> revokeLiveTokens(presented.getUserId()));
            log.warn("Refresh token reuse detected for user {}; revoked {} live token(s)",
                    presented.getUserId(), revoked);
            throw new ApiException(ErrorCode.REFRESH_REUSED,
                    "This session has been ended for security reasons. Please sign in again.");
        }
        if (presented.isExpired(clock.instant())) {
            throw unauthenticated();
        }

        String successorValue = SecretTokens.random();
        Instant expiresAt = clock.instant().plus(ttl);
        RefreshToken successor = presented.rotate(
                SecretTokens.hash(successorValue), expiresAt, clock.instant());
        refreshTokens.save(successor);
        refreshTokens.save(presented);
        return new Rotation(presented.getUserId(), new Issued(successorValue, expiresAt));
    }

    /**
     * Logout. Idempotent for a token that is already revoked or unknown: a client logging out
     * twice, or with a stale cookie, has got what it asked for.
     *
     * <p>The access token is <em>not</em> invalidated — there is nothing to invalidate it with, and
     * inventing a blocklist would trade the one property that makes this design cheap for a
     * fifteen-minute improvement. See {@link JwtService}.
     */
    @Transactional
    public void revoke(String rawToken) {
        findByRaw(rawToken).ifPresent(token -> {
            token.revoke(clock.instant());
            refreshTokens.save(token);
        });
    }

    /**
     * Every live token for a user, in one place because three callers need exactly this: reuse
     * detection, a password reset (D6), and deactivating a staff member.
     *
     * @return how many were revoked, which is what the log line and the tests want
     */
    @Transactional
    public int revokeAllFor(UUID userId) {
        return revokeLiveTokens(userId);
    }

    private int revokeLiveTokens(UUID userId) {
        List<RefreshToken> live = refreshTokens.findByUserIdAndRevokedAtIsNull(userId);
        Instant now = clock.instant();
        live.forEach(token -> token.revoke(now));
        refreshTokens.saveAll(live);
        return live.size();
    }

    private RefreshToken load(String rawToken) {
        return findByRaw(rawToken).orElseThrow(RefreshTokenService::unauthenticated);
    }

    private Optional<RefreshToken> findByRaw(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return Optional.empty();
        }
        return refreshTokens.findByTokenHash(SecretTokens.hash(rawToken));
    }

    /** Unknown and expired are the same answer, for the same reason as everywhere else in auth. */
    private static ApiException unauthenticated() {
        return new ApiException(ErrorCode.UNAUTHENTICATED,
                "That refresh token is not valid. Please sign in again.");
    }
}
