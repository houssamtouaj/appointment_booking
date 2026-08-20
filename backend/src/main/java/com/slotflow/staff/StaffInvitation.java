package com.slotflow.staff;

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
 * An outstanding invitation for a staff member to set a password and become active.
 *
 * <p>A first-class row rather than a bare emailed link, which is what makes it listable,
 * resendable, expirable and consumable exactly once. It points at a {@link User} that already
 * exists and is inactive.
 *
 * <p>Only the SHA-256 hash of the token is stored, never the value that was emailed. A dump of
 * this table is worth nothing to whoever reads it, and the seven-day window means a leaked hash
 * is not even a long-lived nothing.
 *
 * <p>Insert-only: it is created, then stamped {@code used_at} once. There is no
 * {@code updated_at} column, hence {@link AbstractEntity} rather than its mutable sibling.
 */
@Entity
@Table(name = "staff_invitation")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class StaffInvitation extends AbstractEntity {

    @Column(nullable = false, updatable = false)
    private UUID businessId;

    @Column(nullable = false, updatable = false)
    private UUID userId;

    /** Copied from the user so the accept screen can show it without loading the user row. */
    @Column(nullable = false, length = 320, updatable = false)
    private String email;

    @Column(nullable = false, length = 64, unique = true, updatable = false)
    private String tokenHash;

    @Column(nullable = false, updatable = false)
    private Instant expiresAt;

    private Instant usedAt;

    public StaffInvitation(UUID businessId, UUID userId, String email,
                           String tokenHash, Instant expiresAt) {
        this.businessId = businessId;
        this.userId = userId;
        this.email = User.normaliseEmail(email);
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

    /**
     * Guarded rather than idempotent on purpose. A second accept is a distinguishable event —
     * plan 06 answers it with {@code 410 INVITATION_CONSUMED} — and silently succeeding would
     * let a leaked link reset a working account's password.
     */
    public void markUsed(Instant now) {
        if (isUsed()) {
            throw new IllegalStateException("invitation has already been used");
        }
        this.usedAt = now;
    }
}
