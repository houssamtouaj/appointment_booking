package com.slotflow.staff;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.security.AuthPrincipal;
import com.slotflow.security.JwtAuthentication;
import com.slotflow.security.LoginRequest;
import com.slotflow.security.SecretTokens;
import com.slotflow.support.ApiIntegrationTest;
import jakarta.persistence.EntityNotFoundException;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

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

    @Autowired
    private StaffInvitationRepository invitations;

    @Autowired
    private InvitationService invitationService;

    @Autowired
    private StaffAdminService staffAdmin;

    @Autowired
    private PlatformTransactionManager transactionManager;

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
    @DisplayName("an expired invitation stops counting as pending, in the list and on the row")
    void anExpiredInvitationIsNoLongerPending() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        UUID invitedId = users.findByEmailIgnoreCase(email).orElseThrow().getId();

        assertThat(listedMember(staffList(tenant), invitedId).path("invitationPending").asBoolean())
                .isTrue();

        clock.advanceBy(Duration.ofDays(8));

        // The definition of "pending" now lives in one query rather than in a Java filter on one
        // path and a different Java filter on the other, so this is the assertion that would catch
        // the two drifting apart: the whole-team read and the single-row read have to agree.
        assertThat(listedMember(staffList(tenant), invitedId).path("invitationPending").asBoolean())
                .as("no live link left, which is what tells the owner to resend")
                .isFalse();
        mockMvc.perform(get("/api/staff/" + invitedId)
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.invitationPending").value(false))
                .andExpect(jsonPath("$.accepted").value(false));
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
    @DisplayName("a blank token is unknown, not an argument error")
    void blankTokensAreUnknown() {
        // Asserted against the service rather than through MockMvc on purpose. A whitespace path
        // segment never reaches the dispatcher — Spring Security's StrictHttpFirewall answers
        // GET /api/public/invitations/%20 with a bare 400 before any of our code runs — so an HTTP
        // test here would be a test of a framework default we do not set and could not rely on.
        // What is ours is that the lookup treats a blank token the way the endpoint's contract says
        // it should: unknown, and therefore a 404, rather than the IllegalArgumentException from
        // SecretTokens.hash that would surface as a 500 the moment anything relaxed that firewall
        // or called this from somewhere other than a URL.
        assertThatThrownBy(() -> invitationService.preview(" "))
                .isInstanceOf(EntityNotFoundException.class);
        assertThatThrownBy(() -> invitationService.preview(""))
                .isInstanceOf(EntityNotFoundException.class);
        assertThatThrownBy(() -> invitationService.accept("\t",
                new AcceptInvitationRequest("Sam Ferreira", PASSWORD)))
                .isInstanceOf(EntityNotFoundException.class);
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
    @DisplayName("resending to a deactivated ex-employee is refused, not a fresh way in")
    void resendingToADeactivatedColleagueIsAConflict() throws Exception {
        Tenant tenant = aTenant();
        User leaver = aStaffMemberOf(tenant);
        deactivate(tenant, leaver);

        // The invitation is the only route from invited to active, and an ex-employee has already
        // taken it. Resending would mail a live seven-day link to somebody whose access was
        // deliberately withdrawn, and accepting it would set a password of their choosing.
        mockMvc.perform(post("/api/staff/" + leaver.getId() + "/invite/resend")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DATA_CONFLICT"));

        assertThat(notifications.sentNothingTo(leaver.getEmail()))
                .as("and nothing was posted through their door either")
                .isTrue();
    }

    @Test
    @DisplayName("an invitation minted before a deactivation cannot undo it")
    void anOldInvitationCannotReactivateAnyone() throws Exception {
        Tenant tenant = aTenant();
        User leaver = aStaffMemberOf(tenant);
        deactivate(tenant, leaver);

        // The row a resend would have created, reconstructed directly: still unused, still inside
        // its seven days. Accepting it must not be a password reset for an account somebody chose
        // to switch off — the way back is the owner reactivating them, and only that.
        String rawToken = liveInvitationFor(tenant, leaver);

        mockMvc.perform(accept(rawToken, "Sam Renamed", "a-password-of-my-own"))
                .andExpect(status().isGone())
                .andExpect(jsonPath("$.code").value("INVITATION_CONSUMED"));

        User unchanged = users.findById(leaver.getId()).orElseThrow();
        assertThat(unchanged.isActive()).isFalse();
        assertThat(unchanged.getFullName()).isEqualTo(leaver.getFullName());
        login(leaver.getEmail(), "a-password-of-my-own").andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("the list says whether an inactive colleague ever accepted")
    void theListTellsAnInviteeFromALeaver() throws Exception {
        Tenant tenant = aTenant();
        User leaver = aStaffMemberOf(tenant);
        deactivate(tenant, leaver);
        String invitedEmail = invite(tenant);
        UUID invitedId = users.findByEmailIgnoreCase(invitedEmail).orElseThrow().getId();

        // Both rows read active:false, and the owner's next click differs: resend the one, leave
        // the other alone. invitationPending cannot carry that on its own — an invitation that ran
        // out weeks ago makes a pending invitee look exactly like an ex-employee.
        String body = staffList(tenant);

        assertThat(listedMember(body, leaver.getId()).path("accepted").asBoolean())
                .as("deactivated: has a password, so reactivate rather than re-invite")
                .isTrue();
        assertThat(listedMember(body, invitedId).path("accepted").asBoolean())
                .as("invited: no password yet, so resending is the only way in")
                .isFalse();
        assertThat(listedMember(body, leaver.getId()).path("active").asBoolean()).isFalse();
        assertThat(listedMember(body, invitedId).path("active").asBoolean()).isFalse();
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
    @DisplayName("accepting with a passphrase over 72 bytes is a 422, and does not spend the link")
    void oversizedPassphrasesAreRejectedOnAccept() throws Exception {
        Tenant tenant = aTenant();
        String email = invite(tenant);
        String token = notifications.invitationTo(email).rawToken();

        // Same rule as register and reset: 72 characters of Cyrillic are 144 bytes, and BCrypt
        // would read half of them. The invitee has to be told, not quietly given a password whose
        // second half is decoration.
        mockMvc.perform(accept(token, "Sam Ferreira", "пароль".repeat(12)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("password"));

        mockMvc.perform(accept(token, "Sam Ferreira", "пароль".repeat(6)))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("a rolled-back invite mails nothing, so there is no link to a row that never was")
    void nothingIsMailedIfTheTransactionRollsBack() {
        Tenant tenant = aTenant();
        String email = "sam-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
        authenticateAs(tenant);

        // The invite succeeds and the transaction then does not: the app_user_email_key race, a
        // dropped connection, any later exception in the same request. Sending inside that
        // transaction leaves a live-looking seven-day link in somebody's inbox for a user row that
        // does not exist — and no row for the owner to resend from, because there is nothing to
        // resend. The stub cannot fail, so this stays invisible until a real transport lands.
        try {
            new TransactionTemplate(transactionManager).execute(status -> {
                staffAdmin.invite(new InviteStaffRequest(email, "Sam Ferreira", Role.STAFF));
                status.setRollbackOnly();
                return null;
            });
        } finally {
            SecurityContextHolder.clearContext();
        }

        assertThat(users.findByEmailIgnoreCase(email))
                .as("the row is gone, which is the whole reason the mail must not have gone out")
                .isEmpty();
        assertThat(notifications.sentNothingTo(email)).isTrue();
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

    private String staffList(Tenant tenant) throws Exception {
        return mockMvc.perform(get("/api/staff")
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner())))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    /**
     * Puts the owner in the {@code SecurityContext} directly, for the tests that call a service
     * rather than an endpoint: {@link com.slotflow.tenant.TenantContext} reads the {@code bid} claim
     * from there, and there is no filter chain in the way when the call does not go through MockMvc.
     */
    private void authenticateAs(Tenant tenant) {
        SecurityContextHolder.getContext().setAuthentication(new JwtAuthentication(
                new AuthPrincipal(tenant.owner().getId(), tenant.id(), Role.OWNER)));
    }

    /** The one entry of {@code GET /api/staff} with this id, read out of the raw response. */
    private com.fasterxml.jackson.databind.JsonNode listedMember(String body, UUID id)
            throws Exception {
        for (com.fasterxml.jackson.databind.JsonNode member : json.readTree(body)) {
            if (id.toString().equals(member.path("id").asText())) {
                return member;
            }
        }
        throw new AssertionError(id + " is not in the staff list: " + body);
    }

    private void deactivate(Tenant tenant, User member) throws Exception {
        mockMvc.perform(patch("/api/staff/" + member.getId())
                        .header(HttpHeaders.AUTHORIZATION, bearer(tenant.owner()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new UpdateStaffRequest(null, null, false))))
                .andExpect(status().isOk());
        notifications.clear();
    }

    /** The row {@code issueInvitation} would have written, and the raw token only its holder has. */
    private String liveInvitationFor(Tenant tenant, User member) {
        String rawToken = SecretTokens.random();
        invitations.save(new StaffInvitation(tenant.id(), member.getId(), member.getEmail(),
                SecretTokens.hash(rawToken), clock.instant().plus(Duration.ofDays(7))));
        return rawToken;
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
