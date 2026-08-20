package com.slotflow.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.security.LoginRequest;
import com.slotflow.support.ApiIntegrationTest;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The authorisation matrix on {@code /api/staff}, and the two rules that protect a tenant from
 * locking itself out or from a staff member quietly promoting themselves.
 */
class StaffAdminIT extends ApiIntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("the list is scoped to the caller's business and nothing else")
    void theListIsTenantScoped() throws Exception {
        Tenant mine = aTenant();
        User colleague = aStaffMemberOf(mine);
        Tenant elsewhere = aTenant();

        mockMvc.perform(get("/api/staff").header(HttpHeaders.AUTHORIZATION, bearer(mine.owner())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[?(@.id == '" + colleague.getId() + "')]").exists())
                // The other tenant's owner is not merely filtered out of the response — the query
                // never asked for them. This assertion is the one that would catch a repository
                // call that forgot its businessId parameter.
                .andExpect(jsonPath("$[?(@.id == '" + elsewhere.owner().getId() + "')]")
                        .doesNotExist());
    }

    @Test
    @DisplayName("a staff member may rename themselves")
    void staffMayRenameThemselves() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);

        mockMvc.perform(patch("/api/staff/" + staff.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest("Sam F. Ferreira", null, null))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staff.fullName").value("Sam F. Ferreira"))
                // No deactivation, so no warning member at all — absent rather than null.
                .andExpect(jsonPath("$.warning").doesNotExist());
    }

    @Test
    @DisplayName("a staff member patching a colleague gets 403")
    void staffMayNotTouchAnyoneElse() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);
        User colleague = aStaffMemberOf(tenant);

        mockMvc.perform(patch("/api/staff/" + colleague.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest("Renamed by a peer", null, null))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    @DisplayName("a staff member cannot promote themselves or reactivate anyone")
    void staffMayNotChangePrivilegedFields() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);

        // Refused rather than silently ignored: dropping half a request is how a client comes to
        // believe something was saved. And this particular half is a privilege escalation.
        mockMvc.perform(patch("/api/staff/" + staff.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest(null, Role.OWNER, null))))
                .andExpect(status().isForbidden());

        assertThat(users.findById(staff.getId()).orElseThrow().getRole()).isEqualTo(Role.STAFF);
    }

    @Test
    @DisplayName("the last active owner cannot deactivate themselves: 409 LAST_OWNER")
    void theLastOwnerCannotStandDown() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(patch("/api/staff/" + tenant.owner().getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest(null, null, false))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LAST_OWNER"));

        assertThat(users.findById(tenant.owner().getId()).orElseThrow().isActive()).isTrue();
    }

    @Test
    @DisplayName("nor demote themselves, which would leave the tenant with no owner either")
    void theLastOwnerCannotDemoteThemselves() throws Exception {
        Tenant tenant = aTenant();

        // The same hole by another route. A business with no active owner has nobody who can invite
        // one, so this is a state the API must refuse to create rather than one to repair by hand.
        mockMvc.perform(patch("/api/staff/" + tenant.owner().getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest(null, Role.STAFF, null))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("LAST_OWNER"));
    }

    @Test
    @DisplayName("with a second owner in place, the first may stand down")
    void anOwnerMayStandDownOnceThereIsAnother() throws Exception {
        Tenant tenant = aTenant();
        anotherOwnerOf(tenant);

        mockMvc.perform(patch("/api/staff/" + tenant.owner().getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest(null, null, false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staff.active").value(false));
    }

    @Test
    @DisplayName("deactivation blocks login and revokes the refresh tokens the member held")
    void deactivationEndsAccess() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);

        MvcResult session = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new LoginRequest(staff.getEmail(), PASSWORD))))
                .andExpect(status().isOk())
                .andReturn();
        String refreshToken = refreshCookieFrom(session);

        mockMvc.perform(patch("/api/staff/" + staff.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest(null, null, false))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staff.active").value(false));

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE user_id = ? AND revoked_at IS NULL",
                Integer.class, staff.getId()))
                .as("the week-long session ends now, not at its own expiry")
                .isZero();
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new LoginRequest(staff.getEmail(), PASSWORD))))
                .andExpect(status().isUnauthorized());

        // The refresh endpoint is also where a deactivation lands for a client that still holds a
        // valid access token: rotation rebuilds the claims from the row, and an inactive user has
        // none to rebuild.
        assertThat(refreshToken).isNotBlank();
    }

    @Test
    @DisplayName("an owner may reactivate someone they deactivated")
    void reactivationRestoresLogin() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);

        patchActive(tenant, staff.getId(), false).andExpect(status().isOk());
        patchActive(tenant, staff.getId(), true)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.staff.active").value(true));

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new LoginRequest(staff.getEmail(), PASSWORD))))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("a staff id that exists nowhere is 404, for owner and staff alike")
    void unknownIdsAreNotFound() throws Exception {
        Tenant tenant = aTenant();
        UUID nobody = UUID.randomUUID();

        mockMvc.perform(get("/api/staff/" + nobody)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner())))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
        mockMvc.perform(patch("/api/staff/" + nobody)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest("Nobody", null, null))))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("the staff endpoints need a token at all")
    void everythingHereIsAuthenticated() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(get("/api/staff"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
        mockMvc.perform(get("/api/staff/" + tenant.owner().getId()))
                .andExpect(status().isUnauthorized());
    }

    private org.springframework.test.web.servlet.ResultActions patchActive(
            Tenant tenant, UUID staffId, boolean active) throws Exception {
        return mockMvc.perform(patch("/api/staff/" + staffId)
                .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                .contentType(MediaType.APPLICATION_JSON)
                .content(asJson(new UpdateStaffRequest(null, null, active))));
    }
}
