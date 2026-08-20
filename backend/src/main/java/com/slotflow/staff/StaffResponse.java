package com.slotflow.staff;

import java.util.List;
import java.util.UUID;

/**
 * A colleague, as the admin screens see them.
 *
 * <p>This is the tenant-internal view and it does contain an email address, which is correct: the
 * owner invited that person and needs to see who they invited. Its public counterpart,
 * {@link PublicStaffResponse}, is a separate record on purpose — see the note there.
 *
 * @param active      false for someone invited who has not accepted, and for someone deactivated.
 *                    The two are told apart by {@code invitationPending}
 * @param invitationPending an invitation is outstanding: the row exists, the password does not
 * @param serviceIds  what this person performs; empty until plan 07 assigns anything
 */
public record StaffResponse(
        UUID id,
        String email,
        String fullName,
        Role role,
        boolean active,
        boolean invitationPending,
        List<UUID> serviceIds) {
}
