package com.slotflow.staff;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Lookup is always by hash: the raw token exists only in the email that was sent, and hashing the
 * presented value before querying is what keeps it that way.
 */
public interface StaffInvitationRepository extends JpaRepository<StaffInvitation, UUID> {

    Optional<StaffInvitation> findByTokenHash(String tokenHash);

    /** Resending invalidates the previous invitations for that user (plan 06). */
    List<StaffInvitation> findByUserId(UUID userId);

    List<StaffInvitation> findByBusinessId(UUID businessId);

    List<StaffInvitation> findByUserIdAndUsedAtIsNull(UUID userId);
}
