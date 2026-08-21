package com.slotflow.staff;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

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

    List<User> findByBusinessIdAndActiveTrue(UUID businessId);

    /** The tenant-safe read: a foreign id returns empty, which plan 06 turns into a 404, not a 403. */
    Optional<User> findByIdAndBusinessId(UUID id, UUID businessId);

    /** Guards 409 LAST_OWNER: a business must never be left without someone who can administer it. */
    long countByBusinessIdAndRoleAndActiveTrue(UUID businessId, Role role);

    /**
     * "Which of these ids are people in this business?" — the membership test behind
     * {@code 422 STAFF_NOT_IN_BUSINESS} when a service is assigned (plan 07).
     *
     * <p>Ids rather than entities, and the intersection rather than a count: the response has to
     * name the ids that failed, so an owner whose form posted one stale id is told which one. A
     * count would only be able to say that some number of them were wrong.
     */
    @Query("select u.id from User u where u.businessId = :businessId and u.id in :ids")
    List<UUID> findIdsInBusiness(UUID businessId, Collection<UUID> ids);

    /**
     * The tenant's bookable staff, as ids.
     *
     * <p>A projection because both callers only ever ask "is this id in the set?" — the catalog's
     * {@code bookable} flag (plan 07) and the derived opening hours (D5) — and loading whole users to
     * answer that reads three hundred bytes a row to use sixteen.
     */
    @Query("select u.id from User u where u.businessId = :businessId and u.active = true")
    List<UUID> findIdsActiveInBusiness(UUID businessId);
}
