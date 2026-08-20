package com.slotflow.security;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/** Same hash-only discipline as {@link RefreshTokenRepository}. */
public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    /** Requesting a new reset invalidates the outstanding ones (D6). */
    List<PasswordResetToken> findByUserIdAndUsedAtIsNull(UUID userId);

    long deleteByExpiresAtBefore(Instant cutoff);
}
