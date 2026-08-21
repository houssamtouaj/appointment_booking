package com.slotflow.staff;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

/**
 * Lookup is always by hash: the raw token exists only in the email that was sent, and hashing the
 * presented value before querying is what keeps it that way.
 */
public interface StaffInvitationRepository extends JpaRepository<StaffInvitation, UUID> {

    Optional<StaffInvitation> findByTokenHash(String tokenHash);

    /**
     * Whose invitation is live right now — <b>the one definition of "pending" in the codebase</b>.
     *
     * <p>The predicate is the mirror of {@link StaffInvitation#isValid}, and it is here rather than
     * in a Java filter for two reasons. This table only grows: one row per invite, another per
     * resend, none ever deleted, so a team of five can accumulate hundreds of used and long-expired
     * rows and loading them all to discard almost all of them gets slower for a tenant that never
     * changes size. And the staff list and the single-staff response both need the answer — asking
     * it twice in two languages is how the two come to disagree about a row that expired this
     * morning.
     *
     * <p>{@code now} is a parameter rather than {@code current_timestamp} so the answer moves with
     * the injected {@link java.time.Clock}: the tests that advance eight days depend on it, and the
     * database's clock is not the application's.
     *
     * @param userIds already tenant-scoped by the caller — every id comes from a
     *                {@code businessId}-scoped read or a guarded row
     */
    @Query("select i.userId from StaffInvitation i "
            + "where i.userId in :userIds and i.usedAt is null and i.expiresAt > :now")
    Set<UUID> findPendingUserIds(Collection<UUID> userIds, Instant now);

    /** Empty in, empty out, without a round trip — the same guard shape as the other repositories. */
    default Set<UUID> findPending(Collection<UUID> userIds, Instant now) {
        return userIds.isEmpty() ? Set.of() : findPendingUserIds(userIds, now);
    }

    /**
     * Resending supersedes whatever is outstanding for that user (plan 06). Unused rather than
     * unused-and-unexpired on purpose: stamping an expired invitation {@code used} as well costs
     * nothing and leaves no row behind that a later change of the expiry rule could revive.
     */
    List<StaffInvitation> findByUserIdAndUsedAtIsNull(UUID userId);
}
