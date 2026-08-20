package com.slotflow.security;

import com.slotflow.staff.Role;
import java.util.UUID;

/**
 * Everything a request is allowed to know about who is making it: the three claims that were
 * signed into the access token, and nothing read back from the database.
 *
 * <p><b>{@code businessId} is the tenant boundary.</b> It comes from the {@code bid} claim and is
 * the only acceptable source of a tenant id on an admin request — never a path variable, never a
 * query parameter. {@code TenantContext} reads it from here and every tenant-scoped query takes
 * it as a parameter.
 *
 * <p>The role is the token's, on purpose. Reading it from the database on every request would make
 * a role change take effect mid-session and, worse, make two different answers possible for the
 * same request depending on which check looked where. The trade is written down: a role change or
 * a deactivation takes effect on the next refresh, within the 15-minute access-token window.
 */
public record AuthPrincipal(UUID userId, UUID businessId, Role role) {

    public AuthPrincipal {
        if (userId == null || businessId == null || role == null) {
            throw new IllegalArgumentException("userId, businessId and role are all required");
        }
    }

    public boolean isOwner() {
        return role == Role.OWNER;
    }

    /** Spring Security's convention: {@code hasRole('OWNER')} looks for {@code ROLE_OWNER}. */
    public String authority() {
        return "ROLE_" + role.name();
    }

    @Override
    public String toString() {
        return "AuthPrincipal(user=%s, business=%s, role=%s)".formatted(userId, businessId, role);
    }
}
