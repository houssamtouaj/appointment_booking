package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.ApiIntegrationTest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
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

    /**
     * Four callers per round, three rounds. Enough overlap that a read-then-write rotation loses
     * the race reliably rather than occasionally, and few enough that the losers — each holding a
     * row lock and a connection while they wait — stay well inside the ten-connection pool.
     */
    private static final int RACERS = 4;
    private static final int ROUNDS = 3;

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
    @DisplayName("concurrent rotations of one token mint one successor; the losers are REFRESH_REUSED")
    void oneTokenRotatesOnceEvenWhenTheReadsOverlap() throws Exception {
        // "Usable exactly once" is a claim about concurrency, so it cannot be tested sequentially:
        // a single-threaded replay always sees revoked_at already committed and takes the reuse
        // branch whatever the implementation does. What has to hold is that four callers whose
        // reads overlap still produce one successor — a double-clicked tab, an Axios interceptor
        // retrying a dropped response, or a thief racing the victim all produce exactly this.
        for (int round = 1; round <= ROUNDS; round++) {
            Tenant tenant = aTenant();
            String presented = login(tenant);

            List<Integer> statuses = rotateConcurrently(presented);

            assertThat(statuses).as("round %d: exactly one caller may rotate", round)
                    .filteredOn(status -> status == 200)
                    .hasSize(1);
            assertThat(tokenCount(tenant.owner().getId()))
                    .as("round %d: the presented token and its one successor, and nothing else. "
                            + "A second successor is a live session nobody can trace: the chain "
                            + "links to one of them, so the other is a week-long credential with "
                            + "no theft signal attached", round)
                    .isEqualTo(2);
            // And the losers are told it is theft, not merely refused: whichever caller lost the
            // race, the chain is dead and both parties have to sign in again.
            assertThat(liveTokenCount(tenant.owner().getId())).isZero();
            refresh(presented)
                    .andExpect(status().isUnauthorized())
                    .andExpect(jsonPath("$.code").value("REFRESH_REUSED"));
        }
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

    /**
     * Presents one token from {@link #RACERS} threads released together, and returns the status
     * each of them got. The barrier is the point: without it the first caller finishes before the
     * second starts and the test proves nothing about the window between the read and the write.
     */
    private List<Integer> rotateConcurrently(String rawToken) throws Exception {
        ExecutorService racers = Executors.newFixedThreadPool(RACERS);
        CyclicBarrier startTogether = new CyclicBarrier(RACERS);
        try {
            List<Future<Integer>> attempts = new ArrayList<>();
            for (int racer = 0; racer < RACERS; racer++) {
                attempts.add(racers.submit(() -> {
                    startTogether.await(10, TimeUnit.SECONDS);
                    return refresh(rawToken).andReturn().getResponse().getStatus();
                }));
            }
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> attempt : attempts) {
                statuses.add(attempt.get(30, TimeUnit.SECONDS));
            }
            return statuses;
        } finally {
            racers.shutdownNow();
        }
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
    private int tokenCount(UUID userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE user_id = ?", Integer.class, userId);
    }

    private int liveTokenCount(UUID userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM refresh_token WHERE user_id = ? AND revoked_at IS NULL",
                Integer.class, userId);
    }
}
