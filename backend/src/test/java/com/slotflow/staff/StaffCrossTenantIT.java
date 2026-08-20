package com.slotflow.staff;

import com.slotflow.support.CrossTenantTestBase;
import com.slotflow.support.fixtures.Fixtures;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.http.HttpMethod;

/**
 * The first subclass of {@link CrossTenantTestBase}, and the pattern every later admin plan copies:
 * list the endpoints, inherit the assertions.
 *
 * <p>Three endpoints, six generated tests — a refusal and a control for each. The controls are why
 * this class creates an invited colleague in both tenants: {@code invite/resend} on somebody who has
 * already accepted is a 409, so without a genuinely pending invitation on <em>my</em> side the
 * positive leg would fail and the whole case would have to be dropped.
 */
class StaffCrossTenantIT extends CrossTenantTestBase {

    private User myInvitee;
    private User theirInvitee;

    @BeforeEach
    void inviteSomebodyInBothTenants() {
        myInvitee = invitedMemberOf(mine);
        theirInvitee = invitedMemberOf(theirs);
    }

    @Override
    protected List<CrossTenantCase> crossTenantCases() {
        return List.of(
                // A read: another tenant's staff id must look like an id that does not exist.
                CrossTenantCase.read("/api/staff/" + theirs.owner().getId(),
                        "/api/staff/" + mine.owner().getId()),
                // A write: refused outright, and told so.
                CrossTenantCase.write(HttpMethod.PATCH,
                        "/api/staff/" + theirs.owner().getId(),
                        "/api/staff/" + mine.owner().getId(),
                        """
                        {"fullName": "Renamed by the wrong tenant"}
                        """),
                CrossTenantCase.write(HttpMethod.POST,
                        "/api/staff/" + theirInvitee.getId() + "/invite/resend",
                        "/api/staff/" + myInvitee.getId() + "/invite/resend",
                        null));
    }

    /** Invited, never accepted: inactive, no password, and with a live invitation to resend. */
    private User invitedMemberOf(Tenant tenant) {
        // No invitation row: resend supersedes whatever is outstanding, and "outstanding" being
        // empty is itself a real case — the invitation expired weeks ago and the owner tries again.
        return users.save(Fixtures.aStaffMember()
                .forBusiness(tenant.business())
                .invited()
                .build());
    }
}
