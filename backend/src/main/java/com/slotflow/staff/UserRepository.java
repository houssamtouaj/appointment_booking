package com.slotflow.staff;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Every read that is not by primary key takes a {@code businessId}, so tenant scoping is in the
 * method signature rather than in a {@code WHERE} clause somebody has to remember (plan 06).
 */
public interface UserRepository extends JpaRepository<User, UUID> {

    /**
     * Emails are stored lower-cased, so this is belt and braces — but login receives whatever the
     * user typed, and the day someone inserts a row without going through the entity, this is what
     * stops it becoming a duplicate account.
     */
    Optional<User> findByEmailIgnoreCase(String email);

    boolean existsByEmailIgnoreCase(String email);

    List<User> findByBusinessId(UUID businessId);

    List<User> findByBusinessIdAndRole(UUID businessId, Role role);

    List<User> findByBusinessIdAndActiveTrue(UUID businessId);

    /** The tenant-safe read: a foreign id returns empty, which plan 06 turns into a 404, not a 403. */
    Optional<User> findByIdAndBusinessId(UUID id, UUID businessId);

    /** Guards 409 LAST_OWNER: a business must never be left without someone who can administer it. */
    long countByBusinessIdAndRoleAndActiveTrue(UUID businessId, Role role);
}
