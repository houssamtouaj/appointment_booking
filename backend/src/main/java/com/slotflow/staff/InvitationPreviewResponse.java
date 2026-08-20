package com.slotflow.staff;

/**
 * What the accept screen needs before anyone has authenticated: which business is inviting, and to
 * which address. Both are things the recipient of the mail already knows, which is what makes them
 * safe to return for a bare token.
 */
public record InvitationPreviewResponse(String businessName, String email) {
}
