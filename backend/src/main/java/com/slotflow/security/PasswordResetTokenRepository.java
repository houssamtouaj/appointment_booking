package com.slotflow.security;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

/** Same hash-only discipline as {@link RefreshTokenRepository}. */
public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    Optional<PasswordResetToken> findByTokenHash(String tokenHash);

    /** Requesting a new reset invalidates the outstanding ones (D6). */
    List<PasswordResetToken> findByUserIdAndUsedAtIsNull(UUID userId);

    /** Bulk and transactional for the same reasons as {@link RefreshTokenRepository}'s sweep. */
    @Modifying
    @Transactional
    @Query("delete from PasswordResetToken t where t.expiresAt < :cutoff")
    int deleteByExpiresAtBefore(Instant cutoff);
}
