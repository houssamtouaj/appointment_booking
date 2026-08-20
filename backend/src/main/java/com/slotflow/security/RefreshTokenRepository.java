package com.slotflow.security;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * The refresh chain. Nothing here takes a raw token: the caller hashes first, always.
 */
public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    Optional<RefreshToken> findByTokenHash(String tokenHash);

    /**
     * The reuse response: when a token that already has a successor is presented, plan 05 revokes
     * every live token for that user, not only the chain that was replayed. A thief with one
     * captured token gets one use, and the victim is logged out of everything.
     */
    List<RefreshToken> findByUserIdAndRevokedAtIsNull(UUID userId);

    List<RefreshToken> findByUserId(UUID userId);

    /** Housekeeping: an expired token proves nothing and does not need to be kept. */
    long deleteByExpiresAtBefore(Instant cutoff);
}
