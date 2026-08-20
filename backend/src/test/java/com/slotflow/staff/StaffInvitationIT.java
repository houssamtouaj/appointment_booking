package com.slotflow.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.security.LoginRequest;
import com.slotflow.security.SecretTokens;
import com.slotflow.support.ApiIntegrationTest;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Invite, accept, sign in — end to end, plus every way the accept link is allowed to fail.
 *
 * <p>The interesting assertions are the ones about the second attempt. A double-clicked button, a
 * forwarded mail and a stale bookmark all replay an accept link, and the difference between
 * {@code 410} and {@code 500} here is the difference between a clear screen and a support thread.
 * The genuinely dangerous version would be an accept that silently succeeded twice: that is a
 * password reset for an account already in use, reachable by anyone who kept the original mail.
 */
class StaffInvitationIT extends ApiIntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("invite, accept, sign in as the new colleague")
    void theWholeFlow() throws Exception {
        Tenant tenant = aTenant();
        String email = "sam-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";

        mockMvc.perform(post("/api/staff/invite")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new InviteStaffRequest(email, "Sam Ferreira", Role.STAFF))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.email").value(email))
                .andExpect(jsonPath("$.role").value("STAFF"))
                // The user exists before the invitee has done anything, which is what makes an
                // invitation listable and revocable rather than a link floating in an inbox.
                .andExpect(jsonPath("$.active").value(false))
                .andExpect(jsonPath("$.invitationPending").value(true));

        String token = notifications.invitationTo(email).rawToken();

        mockMvc.perform(get("/api/public/invitations/" + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.businessName").value(tenant.business().getName()))
                .andExpect(jsonPath("$.email").value(email))
                // The accept screen needs a name and an address, and gets nothing else — no user id,
                // no role, no business id, all of which would be handing out identifiers to an
                // unauthenticated caller who only proved they hold a link.
                .andExpect(jsonPath("$.length()").value(2));

        // Before accepting, the invitee cannot log in: no password, and inactive.
        login(email, PASSWORD).andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/public/invitations/" + token + "/accept")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new AcceptInvitationRequest("Samir Ferreira", PASSWORD))))
                .andExpect(status().isNoContent());

        login(email, PASSWORD)
                .andExpect(status().isOk())
                // The name the invitee typed wins over the owner's guess.
                .andExpect(jsonPath("$.user.fullName").value("Samir Ferreira"))
                .andExpect(jsonPath("$.user.role").value("STAFF"))
                .andExpect(jsonPath("$.user.business.id").value(tenant.id().toString()));
    }

    @Test
    @DisplayName("accepting twice returns 410 INVITATION_CONSUMED")
    void acceptingTwiceIsGone() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        String token = notifications.invitationTo(email).rawToken();

        mockMvc.perform(accept(token, "Sam Ferreira", PASSWORD))
                .andExpect(status().isNoContent());

        mockMvc.perform(accept(token, "Someone Else", "another-password"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("INVITATION_CONSUMED"));

        // And the second attempt changed nothing — this is the part that matters. A leaked link
        // found later must not be a way to take over a working account.
        login(email, PASSWORD).andExpect(status().isOk());
        login(email, "another-password").andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("an expired invitation is 410 as well, on the pinned clock")
    void expiredInvitationsAreGone() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        String token = notifications.invitationTo(email).rawToken();

        // Seven days is the configured window.
        clock.advanceBy(Duration.ofDays(8));

        mockMvc.perform(get("/api/public/invitations/" + token))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("INVITATION_CONSUMED"));
        mockMvc.perform(accept(token, "Sam Ferreira", PASSWORD))
                .andExpect(status().isGone());
    }

    @Test
    @DisplayName("an invitation still works on day six")
    void invitationsLastAWeek() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        String token = notifications.invitationTo(email).rawToken();

        clock.advanceBy(Duration.ofDays(6));

        mockMvc.perform(accept(token, "Sam Ferreira", PASSWORD))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("a token nobody issued is 404, not 410")
    void unknownTokensAreNotFound() throws Exception {
        // Distinguished from a spent token on purpose: for the person holding the link, one is a
        // typo and the other means "you have already done this". Neither discloses anything they
        // did not already have — they arrived holding the token.
        mockMvc.perform(get("/api/public/invitations/" + SecretTokens.random()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("resending supersedes the previous link")
    void resendInvalidatesTheOldToken() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        String first = notifications.invitationTo(email).rawToken();
        UUID invitedId = users.findByEmailIgnoreCase(email).orElseThrow().getId();

        mockMvc.perform(post("/api/staff/" + invitedId + "/invite/resend")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invitationPending").value(true));

        String second = notifications.invitationTo(email).rawToken();
        assertThat(second).isNotEqualTo(first);

        // Otherwise every "I never got the mail, send it again" leaves another live key to the
        // account for a week.
        mockMvc.perform(accept(first, "Sam Ferreira", PASSWORD))
                .andExpect(status().isGone());
        mockMvc.perform(accept(second, "Sam Ferreira", PASSWORD))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("resending to someone who has already accepted is a conflict")
    void resendingToAnActiveMemberIsAConflict() throws Exception {
        Tenant tenant = aTenant();
        User accepted = aStaffMemberOf(tenant);

        mockMvc.perform(post("/api/staff/" + accepted.getId() + "/invite/resend")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner())))
                .andExpect(status().isConflict());
    }

    @Test
    @DisplayName("an address that already has an account anywhere is 409 EMAIL_TAKEN (D13)")
    void addressesAreGloballyUnique() throws Exception {
        Tenant mine = aTenant();
        Tenant elsewhere = aTenant();

        mockMvc.perform(post("/api/staff/invite")
                        .header(HttpHeaders.AUTHORIZATION, bearer(mine.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new InviteStaffRequest(
                                elsewhere.owner().getEmail(), "Someone", Role.STAFF))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    @DisplayName("a staff member cannot invite anyone")
    void onlyOwnersMayInvite() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);

        mockMvc.perform(post("/api/staff/invite")
                        .header(HttpHeaders.AUTHORIZATION, bearer(staff))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new InviteStaffRequest(
                                "nobody@example.test", "Nobody", Role.STAFF))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    @DisplayName("no invitation token is stored in plaintext")
    void invitationTokensAreStoredHashedOnly() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        String raw = notifications.invitationTo(email).rawToken();

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM staff_invitation WHERE token_hash = ?", Integer.class, raw))
                .isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM staff_invitation WHERE token_hash = ?",
                Integer.class, SecretTokens.hash(raw)))
                .isEqualTo(1);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /** Invites a fresh address through the endpoint and returns it. */
    private String invite(Tenant tenant) throws Exception {
        String email = "sam-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
        mockMvc.perform(post("/api/staff/invite")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new InviteStaffRequest(email, "Sam Ferreira", Role.STAFF))))
                .andExpect(status().isCreated());
        return email;
    }

    private org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder accept(
            String token, String fullName, String password) {
        return post("/api/public/invitations/" + token + "/accept")
                .contentType(MediaType.APPLICATION_JSON)
                .content(asJson(new AcceptInvitationRequest(fullName, password)));
    }

    private org.springframework.test.web.servlet.ResultActions login(String email, String password)
            throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(asJson(new LoginRequest(email, password))));
    }
}
