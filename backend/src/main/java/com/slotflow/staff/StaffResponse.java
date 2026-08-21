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
 * <p>Three of these fields answer one question between them: <b>what does the owner click next?</b>
 * {@code active} false with {@code accepted} false is an invitee, and the answer is resend;
 * {@code active} false with {@code accepted} true is somebody who was deactivated, and the answer
 * is reactivate. {@code invitationPending} cannot carry that distinction on its own, which is why
 * {@code accepted} exists: an invitation that ran out weeks ago leaves a pending invitee looking
 * exactly like an ex-employee, and the two have opposite correct actions. The API refuses the wrong
 * one either way — {@code StaffAdminService.resendInvitation} and {@code activate} each guard the
 * other's case — but a screen that cannot tell them apart invites the attempt.
 *
 * @param active      false for someone invited who has not accepted, and for someone deactivated
 * @param accepted    this person has set a password at some point, so the invitation is behind
 *                    them. Never the hash, only whether one exists
 * @param invitationPending an invitation is outstanding <em>now</em>: unused, and inside its seven
 *                    days
 * @param serviceIds  what this person performs; empty until plan 07 assigns anything
 */
public record StaffResponse(
        UUID id,
        String email,
        String fullName,
        Role role,
        boolean active,
        boolean accepted,
        boolean invitationPending,
        List<UUID> serviceIds) {
}
