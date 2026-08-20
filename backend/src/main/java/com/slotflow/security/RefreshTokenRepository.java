package com.slotflow.security;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

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

    /**
     * Housekeeping: an expired token proves nothing and does not need to be kept.
     *
     * <p>A bulk {@code delete} rather than a derived {@code deleteByExpiresAtBefore}. Spring Data
     * does not make derived query methods transactional, so a cleanup job calling one outside a
     * transaction gets {@code TransactionRequiredException}; and the derived form deletes by
     * selecting every matching row and removing it individually. This is the largest table in the
     * schema — a 7-day TTL with a new row on every refresh — so "load the whole expired set into
     * the persistence context first" is not a theoretical cost.
     */
    @Modifying
    @Transactional
    @Query("delete from RefreshToken t where t.expiresAt < :cutoff")
    int deleteByExpiresAtBefore(Instant cutoff);
}
