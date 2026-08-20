package com.slotflow.security;

import com.slotflow.staff.Role;
import java.util.UUID;

/**
 * {@code GET /api/auth/me}, and also embedded in the login response so a client needs one round
 * trip rather than two.
 *
 * <p>What is absent is the design: no password hash, no {@code active} flag, no business settings
 * beyond {@link BusinessSummary}. This is a hand-written record and not a mapped entity precisely
 * so that adding a column to {@code app_user} cannot add a field here.
 */
public record MeResponse(
        UUID id,
        String email,
        String fullName,
        Role role,
        BusinessSummary business) {
}
