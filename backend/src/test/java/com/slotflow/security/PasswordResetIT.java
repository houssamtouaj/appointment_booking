package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.ApiIntegrationTest;
import com.slotflow.support.RecordingNotificationService;
import com.slotflow.support.TestTime;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;

/**
 * Password reset (D6): single use, one hour, and it ends every session the account has.
 *
 * <p>The last of those is the one worth writing a test for. A reset that leaves existing refresh
 * tokens alive has accomplished nothing in the case it exists for — somebody else knows the old
 * password — and the failure is completely invisible from the endpoint's own response.
 */
class PasswordResetIT extends ApiIntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("forgot-password sends a link and answers 202")
    void requestingAResetSendsALink() throws Exception {
        Tenant tenant = aTenant();

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ForgotPasswordRequest(tenant.owner().getEmail()))))
                .andExpect(status().isAccepted());

        RecordingNotificationService.Sent sent =
                notifications.passwordResetTo(tenant.owner().getEmail());
        assertThat(sent.rawToken()).isNotBlank();
        assertThat(sent.expiresAt()).isEqualTo(TestTime.NOW.plus(Duration.ofHours(1)));
    }

    @Test
    @DisplayName("an unknown address gets the same 202 and no mail at all")
    void unknownAddressesAreIndistinguishable() throws Exception {
        String unknown = "nobody-" + UUID.randomUUID() + "@example.test";

        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ForgotPasswordRequest(unknown))))
                // Not a 404. An endpoint that distinguishes the two is a bulk account-enumeration
                // tool, and it is unauthenticated by necessity.
                .andExpect(status().isAccepted());

        assertThat(notifications.sentNothingTo(unknown)).isTrue();
        assertThat(tokenCountFor(unknown)).isZero();
    }

    @Test
    @DisplayName("the reset sets the password and revokes every refresh token the user holds")
    void resettingEndsEverySession() throws Exception {
        Tenant tenant = aTenant();
        String liveSession = loginAndTakeRefreshToken(tenant);
        String token = requestReset(tenant);
        String newPassword = "a-brand-new-password";

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(token, newPassword))))
                .andExpect(status().isNoContent());

        // Asserted before signing in again, deliberately: a successful login issues a refresh token
        // of its own, and counting live tokens afterwards would find that one and prove nothing.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE user_id = ? AND revoked_at IS NULL",
                Integer.class, tenant.owner().getId()))
                .isZero();
        // The session that existed before the reset is dead, which is the entire point: if the
        // account was taken over, that session is the takeover.
        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new RefreshRequest(liveSession))))
                .andExpect(status().isUnauthorized());

        // And the old password is gone, while the new one works.
        login(tenant.owner().getEmail(), PASSWORD).andExpect(status().isUnauthorized());
        login(tenant.owner().getEmail(), newPassword).andExpect(status().isOk());
    }

    @Test
    @DisplayName("a reset token cannot be used twice")
    void resetTokensAreSingleUse() throws Exception {
        Tenant tenant = aTenant();
        String token = requestReset(tenant);

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(token, "first-new-password"))))
                .andExpect(status().isNoContent());

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(token, "second-new-password"))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));

        // The second attempt changed nothing: a leaked link found later must not be a way in.
        login(tenant.owner().getEmail(), "first-new-password").andExpect(status().isOk());
    }

    @Test
    @DisplayName("a reset token is refused an hour and a minute later")
    void resetTokensExpire() throws Exception {
        Tenant tenant = aTenant();
        String token = requestReset(tenant);

        // The clock moves; the suite does not wait. Sixty-one minutes of a pinned clock costs
        // nothing, and this assertion is impossible to write honestly without one.
        clock.advanceBy(Duration.ofMinutes(61));

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(token, "too-late-password"))))
                .andExpect(status().isUnauthorized());

        // Nothing changed, so the original password still works.
        login(tenant.owner().getEmail(), PASSWORD).andExpect(status().isOk());
    }

    @Test
    @DisplayName("and accepted a minute before the hour is up")
    void resetTokensLiveForTheWholeHour() throws Exception {
        // The other side of the same boundary. Without it, a token that expired immediately would
        // pass the test above and nothing else would notice.
        Tenant tenant = aTenant();
        String token = requestReset(tenant);

        clock.advanceBy(Duration.ofMinutes(59));

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(token, "just-in-time-password"))))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("requesting a second reset invalidates the first link")
    void requestingAgainSupersedesTheOutstandingToken() throws Exception {
        Tenant tenant = aTenant();
        String first = requestReset(tenant);
        String second = requestReset(tenant);

        assertThat(second).isNotEqualTo(first);

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(first, "using-the-old-link"))))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(second, "using-the-new-link"))))
                .andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("no reset token value is stored in plaintext")
    void resetTokensAreStoredHashedOnly() throws Exception {
        Tenant tenant = aTenant();
        String raw = requestReset(tenant);

        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM password_reset_token WHERE token_hash = ?", Integer.class, raw))
                .isZero();
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM password_reset_token WHERE token_hash = ?",
                Integer.class, SecretTokens.hash(raw)))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("a password below the minimum length is a 422, not a 500")
    void shortPasswordsAreRejected() throws Exception {
        Tenant tenant = aTenant();
        String token = requestReset(tenant);

        mockMvc.perform(post("/api/auth/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ResetPasswordRequest(token, "short"))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("password"));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /** Goes through the endpoint and reads the token the way its recipient would: from the mail. */
    private String requestReset(Tenant tenant) throws Exception {
        mockMvc.perform(post("/api/auth/forgot-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new ForgotPasswordRequest(tenant.owner().getEmail()))))
                .andExpect(status().isAccepted());
        return notifications.passwordResetTo(tenant.owner().getEmail()).rawToken();
    }

    private org.springframework.test.web.servlet.ResultActions login(String email, String password)
            throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                .contentType(MediaType.APPLICATION_JSON)
                .content(asJson(new LoginRequest(email, password))));
    }

    private String loginAndTakeRefreshToken(Tenant tenant) throws Exception {
        MvcResult result = login(tenant.owner().getEmail(), PASSWORD)
                .andExpect(status().isOk())
                .andReturn();
        return refreshCookieFrom(result);
    }

    private int tokenCountFor(String email) {
        return jdbc.queryForObject("""
                SELECT count(*) FROM password_reset_token t
                JOIN app_user u ON u.id = t.user_id
                WHERE u.email = ?
                """, Integer.class, email.toLowerCase());
    }
}
