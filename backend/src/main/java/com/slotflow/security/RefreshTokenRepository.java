package com.slotflow.security;

import jakarta.persistence.LockModeType;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

/**
 * The refresh chain. Nothing here takes a raw token: the caller hashes first, always.
 */
public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    /**
     * The only way to look a refresh token up, and it takes a row lock — {@code SELECT … FOR UPDATE}.
     *
     * <p><b>Both callers read this row and then write it</b>, which is a lost-update waiting to
     * happen and, for a token whose whole contract is "usable exactly once", the one that matters.
     * Without the lock two simultaneous {@code POST /api/auth/refresh} with the same value both see
     * {@code revoked_at IS NULL}, both mint a successor, and both commit: the successors have
     * different random hashes so the unique index catches nothing, {@code replaced_by} names one of
     * them, and the other is a seven-day credential with no theft signal attached — exactly the
     * session reuse detection exists to kill. With the lock the second caller waits, re-reads the
     * committed row, finds it revoked, and lands in the {@code REFRESH_REUSED} branch, which is the
     * correct answer to "somebody presented a token that had already been spent".
     *
     * <p>Locking rather than a version column or a guarded conditional update because the swap in
     * {@link RefreshToken#rotate} has to revoke one row and insert another as one step; serialising
     * the readers keeps that logic where it can be read, in the entity, instead of spreading it
     * across an affected-row count. It also fixes logout, where an unlocked read-then-write would
     * blank a {@code replaced_by} a concurrent rotation had just written.
     *
     * <p>There is deliberately no unlocked variant. A lookup by token hash exists to spend the
     * token; anything that only wants to know whether a hash is present can count rows.
     *
     * @throws org.springframework.dao.InvalidDataAccessApiUsageException outside a transaction,
     *         which is the honest failure for a lock that would otherwise be silently dropped
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from RefreshToken t where t.tokenHash = :tokenHash")
    Optional<RefreshToken> findByTokenHashForUpdate(String tokenHash);

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
