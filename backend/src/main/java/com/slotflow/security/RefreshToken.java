package com.slotflow.security;

import com.slotflow.common.jpa.AbstractEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One link in a user's refresh-token chain.
 *
 * <p>The token handed to the client is an opaque 256-bit random value; only its SHA-256 hash
 * lives here. That is the difference between a leaked database being an inconvenience and being
 * every user's session.
 *
 * <p><b>{@code replacedBy} is the interesting column.</b> Rotation revokes the presented token
 * and links it to its successor, which turns replay into something detectable: a token that
 * already has a successor can only have been captured, because the legitimate client moved on to
 * the next one. Plan 05 answers that by revoking the whole chain for the user and returning
 * {@code 401 REFRESH_REUSED} — an attacker who steals a refresh token gets one use before both
 * they and the victim are logged out, and the victim's next request tells them something is
 * wrong.
 */
@Entity
@Table(name = "refresh_token")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RefreshToken extends AbstractEntity {

    @Column(nullable = false, updatable = false)
    private UUID userId;

    /** SHA-256 hex of the value the client holds. 64 characters, unique across the table. */
    @Column(nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(nullable = false, updatable = false)
    private Instant expiresAt;

    private Instant revokedAt;

    /** The successor issued when this token was rotated. Non-null means "already used". */
    private UUID replacedBy;

    public RefreshToken(UUID userId, String tokenHash, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    public boolean isRevoked() {
        return revokedAt != null;
    }

    public boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    /** Presenting a token for which this is false is either an expiry or a theft; plan 05 tells them apart. */
    public boolean isValid(Instant now) {
        return !isRevoked() && !isExpired(now);
    }

    /** The reuse signal: a token with a successor has already done its one job. */
    public boolean hasSuccessor() {
        return replacedBy != null;
    }

    public void revoke(Instant now) {
        if (!isRevoked()) {
            this.revokedAt = now;
        }
    }

    /**
     * Rotates this token: revokes it, links it to a fresh successor, and returns the successor
     * for the caller to persist and hand to the client.
     *
     * <p>Both sides of the swap happen here, in one method, because a rotation that revokes
     * without linking loses the theft signal and a rotation that links without revoking leaves
     * two live tokens.
     */
    public RefreshToken rotate(String successorTokenHash, Instant successorExpiresAt, Instant now) {
        if (isRevoked()) {
            throw new IllegalStateException("a revoked refresh token cannot be rotated");
        }
        RefreshToken successor = new RefreshToken(userId, successorTokenHash, successorExpiresAt);
        this.replacedBy = successor.getId();
        this.revokedAt = now;
        return successor;
    }
}
