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
 * A single-use, one-hour ticket to set a new password (D6).
 *
 * <p>Same discipline as {@link RefreshToken}: the emailed value is random and never stored, only
 * its SHA-256 hash. Single use is enforced by {@code usedAt} rather than by deleting the row, so
 * a second attempt can be answered accurately instead of looking like an unknown token.
 *
 * <p>Plan 05 revokes every refresh token for the user when one of these is consumed. Resetting a
 * password because the account may be compromised has to end the sessions that compromise
 * created, or the reset accomplishes nothing.
 */
@Entity
@Table(name = "password_reset_token")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PasswordResetToken extends AbstractEntity {

    @Column(nullable = false, updatable = false)
    private UUID userId;

    @Column(nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(nullable = false, updatable = false)
    private Instant expiresAt;

    private Instant usedAt;

    public PasswordResetToken(UUID userId, String tokenHash, Instant expiresAt) {
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.expiresAt = expiresAt;
    }

    public boolean isUsed() {
        return usedAt != null;
    }

    public boolean isExpired(Instant now) {
        return !now.isBefore(expiresAt);
    }

    public boolean isValid(Instant now) {
        return !isUsed() && !isExpired(now);
    }

    public void markUsed(Instant now) {
        if (isUsed()) {
            throw new IllegalStateException("reset token has already been used");
        }
        this.usedAt = now;
    }
}
