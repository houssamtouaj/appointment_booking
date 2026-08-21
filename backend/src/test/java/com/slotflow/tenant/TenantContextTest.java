package com.slotflow.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.slotflow.business.Business;
import com.slotflow.security.AuthPrincipal;
import com.slotflow.security.JwtAuthentication;
import com.slotflow.staff.Role;
import com.slotflow.staff.User;
import jakarta.persistence.EntityNotFoundException;
import java.time.ZoneId;
import java.util.Currency;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.AuthenticationCredentialsNotFoundException;
import org.springframework.security.core.context.SecurityContextHolder;

/**
 * The tenant guard, tested where its two exception types are the whole contract.
 *
 * <p>The status codes those exceptions become are asserted end to end by
 * {@code CrossTenantTestBase}'s subclasses; what is worth pinning here is which exception each
 * method throws, because the difference between {@code EntityNotFoundException} and
 * {@code AccessDeniedException} is the difference between "that does not exist" and "that exists
 * and is not yours" — and one of those two answers, on a read path, is a map of another tenant's
 * data.
 */
class TenantContextTest {

    private final TenantContext tenant = new TenantContext();

    private static final UUID MY_BUSINESS = UUID.randomUUID();
    private static final UUID THEIR_BUSINESS = UUID.randomUUID();

    /**
     * Both ends, not just the tidy one. The {@code SecurityContext} is a thread local and the
     * surefire fork reuses its thread across classes, so clearing only afterwards protects the next
     * test in <em>this</em> class and nothing else: the first test to run here inherits whatever
     * some other class left behind. {@link #anUnauthenticatedRequestHasNoTenant} is the one that
     * would notice — if it happens to run first, a stale authentication makes it fail for a reason
     * that has nothing to do with tenancy, in a class that is nowhere near the cause.
     */
    @BeforeEach
    @AfterEach
    void clearTheContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    @DisplayName("the tenant, the user and the role all come from the token's claims")
    void readsTheClaimsFromTheSecurityContext() {
        AuthPrincipal principal = authenticateAs(Role.OWNER);

        assertThat(tenant.businessId()).isEqualTo(MY_BUSINESS);
        assertThat(tenant.userId()).isEqualTo(principal.userId());
        assertThat(tenant.role()).isEqualTo(Role.OWNER);
        assertThat(tenant.isOwner()).isTrue();
        assertThat(tenant.isSelf(principal.userId())).isTrue();
        assertThat(tenant.isSelf(UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("a read of another tenant's row is reported as absent")
    void readsHideForeignRows() {
        authenticateAs(Role.OWNER);

        assertThatThrownBy(() -> tenant.requireOwned(userOf(THEIR_BUSINESS)))
                .isInstanceOf(EntityNotFoundException.class);
    }

    @Test
    @DisplayName("a write to another tenant's row is refused outright")
    void writesRefuseForeignRows() {
        authenticateAs(Role.OWNER);

        assertThatThrownBy(() -> tenant.requireOwnedForWrite(userOf(THEIR_BUSINESS)))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    @DisplayName("an owned entity passes both guards and is handed back")
    void ownedEntitiesPass() {
        authenticateAs(Role.OWNER);
        User mine = userOf(MY_BUSINESS);

        assertThat(tenant.owns(mine)).isTrue();
        assertThat(tenant.requireOwned(mine)).isSameAs(mine);
        assertThat(tenant.requireOwnedForWrite(mine)).isSameAs(mine);
    }

    @Test
    @DisplayName("the tenant root itself is guarded like everything else")
    void businessesAreTenantOwnedToo() {
        authenticateAs(Role.OWNER);
        // Business returns its own id from getBusinessId(), which is why the guard needs no special
        // case for the one entity that is its own tenant.
        Business foreign = new Business("other-clinic", "Other Clinic",
                ZoneId.of("Europe/Paris"), Currency.getInstance("EUR"));

        assertThat(tenant.owns(foreign)).isFalse();
        assertThatThrownBy(() -> tenant.requireOwned(foreign))
                .isInstanceOf(EntityNotFoundException.class);
    }

    @Test
    @DisplayName("null is not owned, whatever the caller hoped")
    void nullIsNeverOwned() {
        authenticateAs(Role.OWNER);

        assertThat(tenant.owns(null)).isFalse();
        assertThatThrownBy(() -> tenant.requireOwned(null))
                .isInstanceOf(EntityNotFoundException.class);
    }

    @Test
    @DisplayName("a staff member may act on themselves and on nobody else")
    void staffMayOnlyActOnThemselves() {
        AuthPrincipal principal = authenticateAs(Role.STAFF);

        tenant.requireOwnerOrSelf(principal.userId());

        assertThatThrownBy(() -> tenant.requireOwnerOrSelf(UUID.randomUUID()))
                .isInstanceOf(AccessDeniedException.class);
    }

    @Test
    @DisplayName("an owner may act on anyone in their tenant")
    void ownersMayActOnAnyone() {
        authenticateAs(Role.OWNER);

        tenant.requireOwnerOrSelf(UUID.randomUUID());
    }

    @Test
    @DisplayName("asking for a tenant with nobody authenticated is a 401, not a 500")
    void anUnauthenticatedRequestHasNoTenant() {
        // Only reachable from a public endpoint that asked for a tenant — a programming error, and
        // one that should surface as an honest 401 rather than as a null-pointer 500.
        assertThatThrownBy(tenant::businessId)
                .isInstanceOf(AuthenticationCredentialsNotFoundException.class);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private static AuthPrincipal authenticateAs(Role role) {
        AuthPrincipal principal = new AuthPrincipal(UUID.randomUUID(), MY_BUSINESS, role);
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthentication(principal));
        return principal;
    }

    private static User userOf(UUID businessId) {
        return User.owner(businessId, "someone@example.test", "Someone", "$2a$04$hash");
    }
}
