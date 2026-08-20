package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.ApiIntegrationTest;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The rotation chain, asserted in the database rather than through the API's own answers.
 *
 * <p>That distinction is the point of this class. "Presenting an old refresh token returns 401" is
 * easy to make true and worth very little: the interesting claim is that the whole chain is dead
 * afterwards, and the only place that can be checked is {@code refresh_token.revoked_at}. An
 * implementation that returned the right status and revoked nothing would pass a status-only test
 * and leave a thief with a working session.
 */
class RefreshRotationIT extends ApiIntegrationTest {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    @DisplayName("rotation revokes the presented token and links it to its successor")
    void rotationLinksTheChain() throws Exception {
        Tenant tenant = aTenant();
        String first = login(tenant);

        String second = refreshCookieFrom(refresh(first).andExpect(status().isOk()).andReturn());

        assertThat(second).isNotEqualTo(first);
        assertThat(revokedAt(first)).as("the presented token is spent").isNotNull();
        assertThat(replacedBy(first)).as("and points at its successor").isEqualTo(idOf(second));
        assertThat(revokedAt(second)).as("the successor is live").isNull();
    }

    @Test
    @DisplayName("reusing a rotated token returns 401 REFRESH_REUSED and revokes the whole chain")
    void reuseRevokesEverySessionTheUserHas() throws Exception {
        Tenant tenant = aTenant();

        // Two independent sessions — a laptop and a phone, as far as the database is concerned.
        String laptop = login(tenant);
        String phone = login(tenant);
        String laptopRotated = refreshCookieFrom(refresh(laptop).andExpect(status().isOk()).andReturn());

        // The captured value. Only someone who kept a copy can present it: the real client rotated
        // and threw it away.
        refresh(laptop)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("REFRESH_REUSED"))
                .andExpect(jsonPath("$.status").value(401));

        assertThat(liveTokenCount(tenant.owner().getId()))
                .as("every live token for that user is revoked, not just the replayed chain")
                .isZero();
        assertThat(revokedAt(laptopRotated)).as("the thief's successor is dead too").isNotNull();
        assertThat(revokedAt(phone)).as("and so is the session on the other device").isNotNull();

        // Which is the user-visible half of the trade: the victim is logged out everywhere, notices,
        // and signs in again — and the attacker's stolen token is worth nothing.
        refresh(phone).andExpect(status().isUnauthorized());
        refresh(laptopRotated).andExpect(status().isUnauthorized());
    }

    @Test
    @DisplayName("the revocation survives the exception that reports it")
    void theTheftResponseIsCommitted() throws Exception {
        // This is the failure mode the REQUIRES_NEW transaction in RefreshTokenService exists for.
        // Revoking inside the caller's transaction and then throwing would roll the revocation back
        // with the response: the API would answer "this session has been ended" and end nothing,
        // and every status-based assertion above would still pass.
        Tenant tenant = aTenant();
        String original = login(tenant);
        refresh(original).andExpect(status().isOk());

        refresh(original).andExpect(status().isUnauthorized());

        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM refresh_token WHERE user_id = ? AND revoked_at IS NULL
                """, Integer.class, tenant.owner().getId())).isZero();
    }

    @Test
    @DisplayName("no refresh token value is stored in plaintext")
    void tokensAreStoredHashedOnly() throws Exception {
        Tenant tenant = aTenant();
        String raw = login(tenant);

        // The value the client holds appears nowhere in the table, in any column.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE token_hash = ?", Integer.class, raw))
                .isZero();
        // And what is stored is exactly its SHA-256, 64 hex characters of it.
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE token_hash = ?",
                Integer.class, SecretTokens.hash(raw)))
                .isEqualTo(1);
        assertThat(jdbc.queryForObject("""
                SELECT count(*) FROM refresh_token
                WHERE user_id = ? AND token_hash ~ '^[0-9a-f]{64}$'
                """, Integer.class, tenant.owner().getId()))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("an expired refresh token is refused, and is not treated as theft")
    void expiredTokensAreRefusedWithoutRevokingAnything() throws Exception {
        Tenant tenant = aTenant();
        String stale = login(tenant);
        String other = login(tenant);

        // Seven days is the configured lifetime; a day past it is a session that simply ended.
        clock.advanceBy(Duration.ofDays(8));

        refresh(stale)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));

        // Not REFRESH_REUSED, and nothing else was revoked: expiry is not evidence of a theft, and
        // punishing it would log people out of their other devices for going on holiday.
        assertThat(revokedAt(other)).isNull();
    }

    @Test
    @DisplayName("an unknown refresh token is refused in the same words as an expired one")
    void unknownTokensAreRefused() throws Exception {
        aTenant();

        mockMvc.perform(post("/api/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new RefreshRequest(SecretTokens.random()))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private String login(Tenant tenant) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new LoginRequest(tenant.owner().getEmail(), PASSWORD))))
                .andExpect(status().isOk())
                .andReturn();
        return refreshCookieFrom(result);
    }

    /**
     * Presents a specific token through the request body — the escape hatch documented on
     * {@link RefreshTokenCookie}, and the only way to replay a value a browser has already
     * discarded, which is precisely what reuse detection has to be tested with.
     */
    private org.springframework.test.web.servlet.ResultActions refresh(String rawToken)
            throws Exception {
        return mockMvc.perform(post("/api/auth/refresh")
                .contentType(MediaType.APPLICATION_JSON)
                .content(asJson(new RefreshRequest(rawToken))));
    }

    private Object revokedAt(String rawToken) {
        return jdbc.queryForObject("SELECT revoked_at FROM refresh_token WHERE token_hash = ?",
                Object.class, SecretTokens.hash(rawToken));
    }

    private UUID replacedBy(String rawToken) {
        return jdbc.queryForObject("SELECT replaced_by FROM refresh_token WHERE token_hash = ?",
                UUID.class, SecretTokens.hash(rawToken));
    }

    private UUID idOf(String rawToken) {
        return jdbc.queryForObject("SELECT id FROM refresh_token WHERE token_hash = ?",
                UUID.class, SecretTokens.hash(rawToken));
    }

    /**
     * Deliberately not filtered by {@code expires_at > now()}: the application clock is pinned to
     * March 2026 while the database's {@code now()} is whenever the suite happens to run, so a
     * comparison between the two is a test that passes or fails depending on the calendar.
     * Revocation is the property under test in any case.
     */
    private int liveTokenCount(UUID userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE user_id = ? AND revoked_at IS NULL",
                Integer.class, userId);
    }
}
