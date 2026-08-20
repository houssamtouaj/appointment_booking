package com.slotflow.tenant;

import com.slotflow.security.AuthPrincipal;
import com.slotflow.staff.Role;
import jakarta.persistence.EntityNotFoundException;
import java.util.UUID;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;

/**
 * The tenant boundary, as one object every service calls.
 *
 * <h2>Where the tenant id comes from</h2>
 * The {@code bid} claim of the access token, and nowhere else. Never a path variable, never a query
 * parameter, never a request body — a caller who could name their own tenant would not need to
 * attack anything. {@code JwtAuthenticationFilter} verified the signature and put the claims in the
 * {@code SecurityContext}; this reads them from there rather than from a second request-scoped bean
 * populated by a second filter, because two sources of the same truth can disagree and only one of
 * them would be the one the guard checks.
 *
 * <h2>Two methods, two status codes, and the difference matters</h2>
 * <ul>
 *   <li>{@link #requireOwned} — <b>read paths → 404.</b> A foreign id must be indistinguishable
 *       from one that does not exist. Answering 403 confirms the row is real, which turns any
 *       admin endpoint into an existence oracle: iterate ids, collect the 403s, and you have
 *       mapped another tenant's data without reading a single field of it.</li>
 *   <li>{@link #requireOwnedForWrite} — <b>write paths → 403.</b> The disclosure argument is
 *       weaker here (a write attempt is not a survey) and the honest answer is more useful: the
 *       caller is authenticated and is being refused. This is the split plan 06 specifies and
 *       {@code CrossTenantTestBase} asserts for every admin endpoint from here on.</li>
 * </ul>
 *
 * <p>The guard takes {@link TenantOwned}, so there is no per-entity overload to forget when a
 * twelfth entity arrives. It is the second line, not the first: repositories take {@code businessId}
 * as a parameter ({@code findByIdAndBusinessId}), which is what stops a cross-tenant row being
 * loaded at all. This catches the paths where a row is legitimately loaded by id first.
 */
@Component
public class TenantContext {

    /**
     * The caller.
     *
     * @throws AuthenticationCredentialsNotFoundException if there is none, which the error handler
     *         turns into a 401. Reachable only from a public endpoint that asked for a tenant, i.e.
     *         a programming error, and a 401 is the honest answer to it rather than a 500.
     */
    public AuthPrincipal principal() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthPrincipal principal)) {
            throw new AuthenticationCredentialsNotFoundException(
                    "no authenticated tenant on this request");
        }
        return principal;
    }

    /** The tenant every query on this request must be scoped to. */
    public UUID businessId() {
        return principal().businessId();
    }

    public UUID userId() {
        return principal().userId();
    }

    public Role role() {
        return principal().role();
    }

    public boolean isOwner() {
        return principal().isOwner();
    }

    public boolean isSelf(UUID userId) {
        return principal().userId().equals(userId);
    }

    // ---------------------------------------------------------------------------------
    //  the guard
    // ---------------------------------------------------------------------------------

    public boolean owns(TenantOwned entity) {
        return entity != null && businessId().equals(entity.getBusinessId());
    }

    /**
     * For a read: a row belonging to another tenant is reported as absent.
     *
     * @return the entity, so call sites read as {@code var staff = tenant.requireOwned(loaded);}
     */
    public <T extends TenantOwned> T requireOwned(T entity) {
        if (!owns(entity)) {
            // The message is for the log. The client gets the generic 404 body from the handler.
            throw new EntityNotFoundException(
                    "entity does not belong to business " + businessId());
        }
        return entity;
    }

    /** For a write: an authenticated caller reaching into another tenant is refused, not misled. */
    public <T extends TenantOwned> T requireOwnedForWrite(T entity) {
        if (!owns(entity)) {
            throw new AccessDeniedException("entity does not belong to business " + businessId());
        }
        return entity;
    }

    /**
     * Owner-only operations that {@code @PreAuthorize} cannot express because the rule depends on
     * the target — "an owner, or a staff member acting on themselves".
     */
    public void requireOwnerOrSelf(UUID targetUserId) {
        if (!isOwner() && !isSelf(targetUserId)) {
            throw new AccessDeniedException("staff members may only act on their own record");
        }
    }
}
