package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.staff.User;
import com.slotflow.support.ApiIntegrationTest;
import java.util.Base64;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

/**
 * The wave-3 exit demo, as a test: register, sign in, call {@code /me}, refresh, call it again.
 *
 * <p>Everything else here is a way the flow is allowed to fail. The three that matter most are the
 * transaction boundary on registration, the identical-body rule for failed logins, and the shape of
 * a 401 raised inside the security filter chain — the response Spring Security would otherwise
 * write itself, in a format nothing else in this API uses.
 */
class AuthFlowIT extends ApiIntegrationTest {

    @Autowired
    private AuthService authService;

    // ---------------------------------------------------------------------------------
    //  registration
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("register creates the business, its policy and its owner, and signs them in")
    void registerCreatesTheWholeTenant() throws Exception {
        RegisterRequest request = registration();

        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.email").value(request.email()))
                .andExpect(jsonPath("$.user.role").value("OWNER"))
                .andExpect(jsonPath("$.user.business.slug").value(request.slug()))
                .andExpect(jsonPath("$.user.business.timezone").value("Europe/Paris"))
                .andExpect(jsonPath("$.user.business.currency").value("EUR"))
                // The refresh token is in the cookie and nowhere else. If it ever appears here, the
                // SPA will put it in localStorage within a week, whatever the README says.
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn();

        assertThat(refreshCookieFrom(result)).isNotBlank();

        // All three rows, which is what "one transaction" is for.
        var business = businesses.findBySlug(request.slug()).orElseThrow();
        assertThat(policies.findById(business.getId())).isPresent();
        assertThat(users.findByEmailIgnoreCase(request.email())).get()
                .satisfies(owner -> {
                    assertThat(owner.getBusinessId()).isEqualTo(business.getId());
                    assertThat(owner.isOwner()).isTrue();
                    assertThat(owner.canLogIn()).isTrue();
                });
    }

    @Test
    @DisplayName("the refresh cookie is httpOnly, SameSite=Lax and scoped to /api/auth")
    void refreshCookieCarriesItsSecurityAttributes() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(registration())))
                .andExpect(status().isCreated())
                .andReturn();

        // Asserted on the raw header, because these four attributes are the entire security
        // argument for putting a seven-day credential in a browser.
        String setCookie = result.getResponse().getHeader(HttpHeaders.SET_COOKIE);
        assertThat(setCookie)
                .startsWith(REFRESH_COOKIE_NAME + "=")
                .contains("HttpOnly")
                .contains("SameSite=Lax")
                .contains("Path=/api/auth")
                .contains("Max-Age=604800");
    }

    @Test
    @DisplayName("a taken slug is 409 SLUG_TAKEN, so the form can offer another")
    void takenSlugIsAConflict() throws Exception {
        RegisterRequest first = registration();
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(first)))
                .andExpect(status().isCreated());

        RegisterRequest sameSlug = registration(first.slug(), uniqueEmail());

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(sameSlug)))
                .andExpect(status().isConflict())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("SLUG_TAKEN"))
                .andExpect(jsonPath("$.slug").value(first.slug()));
    }

    @Test
    @DisplayName("a taken email is 409 EMAIL_TAKEN, even across tenants (D13)")
    void takenEmailIsAConflict() throws Exception {
        Tenant existing = aTenant();

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(registration(uniqueSlug(), existing.owner().getEmail()))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("EMAIL_TAKEN"));
    }

    @Test
    @DisplayName("a malformed slug is 422 with the field named, not a 409")
    void malformedSlugIsAValidationFailure() throws Exception {
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(registration("no spaces allowed", uniqueEmail()))))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("slug"));
    }

    @Test
    @DisplayName("an unknown timezone is 422 in the same shape the binder produces")
    void unknownTimezoneIsAValidationFailure() throws Exception {
        RegisterRequest request = new RegisterRequest("Dana Clinic", uniqueSlug(),
                "Mars/Olympus_Mons", "EUR", "Dana Okoye", uniqueEmail(), PASSWORD);

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("timezone"))
                .andExpect(jsonPath("$.errors[0].message")
                        .value("must be an IANA zone id such as Europe/Paris"));
    }

    @Test
    @DisplayName("a passphrase over 72 bytes is refused, because BCrypt would only read 72 of them")
    void oversizedPassphrasesAreRejected() throws Exception {
        // 72 characters — inside every character-counted limit — and 144 UTF-8 bytes. BCrypt reads
        // the first 72 bytes and ignores the rest, so accepting this registers an account whose
        // password is really its first 36 characters: anyone who knows that much signs in as its
        // owner. PasswordsTest pins that truncation directly.
        RegisterRequest request = new RegisterRequest("Dana Clinic", uniqueSlug(), "Europe/Paris",
                "EUR", "Dana Okoye", uniqueEmail(), "пароль".repeat(12));

        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(request)))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("password"));

        assertThat(users.findByEmailIgnoreCase(request.email())).isEmpty();
    }

    @Test
    @DisplayName("a 72-byte passphrase in any alphabet is accepted")
    void passphrasesUpToSeventyTwoBytesAreAccepted() throws Exception {
        // The limit is bytes, so the same 72 bytes are 72 Latin characters or 36 Cyrillic ones, and
        // both are fine. Rejecting the shorter-looking one would be the mirror mistake.
        mockMvc.perform(post("/api/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(asJson(new RegisterRequest("Dana Clinic", uniqueSlug(),
                                "Europe/Paris", "EUR", "Dana Okoye", uniqueEmail(),
                                "пароль".repeat(6)))))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a failure on the last insert leaves no half-built tenant behind")
    void registrationIsAllOrNothing() {
        // The service is called directly, past bean validation, with a name that fits the Java field
        // and not the varchar(120) — so the insert of the third row is what fails, which is exactly
        // the case a missing transaction would leave behind as a business with no owner. A business
        // whose slug is taken and whose owner does not exist cannot be repaired through the API:
        // the owner cannot register, and nobody can log in to fix it.
        //
        // The transaction is AuthService.writes, a TransactionTemplate around the three inserts,
        // rather than @Transactional on the method — the password hash happens before it opens so
        // that a connection is not parked for the length of a BCrypt. This test is what would catch
        // that template being dropped: without it the business commits on its own and survives.
        String slug = uniqueSlug();
        RegisterRequest request = new RegisterRequest("Dana Clinic", slug, "Europe/Paris", "EUR",
                "N".repeat(200), uniqueEmail(), PASSWORD);

        assertThatThrownBy(() -> authService.register(request))
                .isInstanceOf(RuntimeException.class);

        assertThat(businesses.findBySlug(slug)).isEmpty();
        assertThat(users.findByEmailIgnoreCase(request.email())).isEmpty();
    }

    // ---------------------------------------------------------------------------------
    //  the exit demo
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("login, /me, refresh, /me again — all green")
    void theHappyPath() throws Exception {
        Tenant tenant = aTenant();

        MvcResult login = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(tenant.owner().getEmail(), PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.id").value(tenant.owner().getId().toString()))
                .andReturn();

        String accessToken = accessTokenFrom(login);
        String refreshToken = refreshCookieFrom(login);

        mockMvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(tenant.owner().getEmail()))
                .andExpect(jsonPath("$.business.id").value(tenant.id().toString()));

        MvcResult refreshed = mockMvc.perform(post("/api/auth/refresh")
                        .cookie(new jakarta.servlet.http.Cookie(REFRESH_COOKIE_NAME, refreshToken)))
                .andExpect(status().isOk())
                .andReturn();

        assertThat(refreshCookieFrom(refreshed))
                .as("rotation issues a different token every time")
                .isNotEqualTo(refreshToken);

        mockMvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessTokenFrom(refreshed)))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("/me without a token is a 401 problem detail, not Spring Security's own body")
    void unauthenticatedRequestsGetTheProblemShape() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.type").value("https://slotflow.dev/problems/unauthenticated"))
                .andExpect(jsonPath("$.title").value("Authentication required"))
                .andExpect(jsonPath("$.status").value(401))
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"))
                .andExpect(jsonPath("$.instance").value("/api/auth/me"));
    }

    @Test
    @DisplayName("a forged or corrupt access token is refused, and says no more than that")
    void tamperedTokensAreRefused() throws Exception {
        Tenant tenant = aTenant();
        String token = jwtService.issue(tenant.owner());
        String forged = withCorruptedSignature(token);

        mockMvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + forged))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    /**
     * Same claims, genuinely different MAC.
     *
     * <p>The obvious version of this — replace the last character of the signature with {@code A},
     * or with {@code B} if it was already {@code A} — is wrong exactly one time in sixteen, which
     * is why it survived six waves and then failed a CI run on a commit that had already passed.
     *
     * <p>An HS256 signature is 32 bytes, and base64url encodes it as 43 characters: 258 bits of
     * alphabet carrying 256 bits of signature. The final character holds only four significant
     * bits, so a canonical encoder always leaves its low two bits clear and only sixteen of the
     * sixty-four characters can ever appear there — {@code A E I M Q U Y c g k o s w 0 4 8}. A
     * decoder discards those low bits again, which puts {@code A B C D} in one collision group.
     *
     * <p>So when the signature happened to end in {@code A}, the replacement {@code B} decoded
     * back to the very same 32 bytes: a token that was never forged, correctly answered with 200,
     * failing an assertion that demanded 401. One in sixteen, measured at 6.07% over 100k samples.
     *
     * <p>Flipping a bit in the decoded bytes cannot collide, because every one of those bits is
     * significant.
     */
    private static String withCorruptedSignature(String token) {
        int lastDot = token.lastIndexOf('.');
        byte[] signature = Base64.getUrlDecoder().decode(token.substring(lastDot + 1));
        signature[0] ^= 0x01;
        return token.substring(0, lastDot + 1)
                + Base64.getUrlEncoder().withoutPadding().encodeToString(signature);
    }

    // ---------------------------------------------------------------------------------
    //  login hardening
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("wrong password, unknown email and a deactivated user return byte-identical bodies")
    void failedLoginsAreIndistinguishable() throws Exception {
        Tenant tenant = aTenant();
        User deactivated = aStaffMemberOf(tenant);
        deactivated.deactivate();
        users.save(deactivated);

        String wrongPassword = loginResponseBody(tenant.owner().getEmail(), "not-the-password");
        String unknownEmail = loginResponseBody(uniqueEmail(), PASSWORD);
        String inactiveUser = loginResponseBody(deactivated.getEmail(), PASSWORD);

        // Byte for byte, including detail and instance. Any difference at all — a distinct code, a
        // reworded detail, a missing member — is an oracle for "does this address have an account
        // here", which is the first thing an attacker enumerates.
        assertThat(wrongPassword).isEqualTo(unknownEmail).isEqualTo(inactiveUser);
        assertThat(wrongPassword).contains("\"code\":\"UNAUTHENTICATED\"");
    }

    @Test
    @DisplayName("a user who cannot log in gets no session, whatever their password")
    void deactivatedUsersCannotLogIn() throws Exception {
        Tenant tenant = aTenant();
        User staff = aStaffMemberOf(tenant);
        staff.deactivate();
        users.save(staff);

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(staff.getEmail(), PASSWORD)))
                .andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------------------------
    //  logout
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("logout kills the refresh token; the access token survives until it expires")
    void logoutRevokesTheRefreshTokenOnly() throws Exception {
        Tenant tenant = aTenant();
        MvcResult login = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(tenant.owner().getEmail(), PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        String accessToken = accessTokenFrom(login);
        String refreshToken = refreshCookieFrom(login);

        MvcResult loggedOut = mockMvc.perform(post("/api/auth/logout")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken)
                        .cookie(new jakarta.servlet.http.Cookie(REFRESH_COOKIE_NAME, refreshToken)))
                .andExpect(status().isNoContent())
                .andReturn();

        // The cookie is cleared on the client too, or the browser keeps presenting a dead token.
        assertThat(loggedOut.getResponse().getHeader(HttpHeaders.SET_COOKIE))
                .contains("Max-Age=0");

        // Documented trade-off, asserted so that it stays a decision rather than a surprise: the
        // access token is still good for the rest of its 15 minutes, because verifying it touches
        // no state. A blocklist would undo the one property that makes it cheap.
        mockMvc.perform(get("/api/auth/me").header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
                .andExpect(status().isOk());

        // The refresh token, though, is gone — and presenting it again is treated as reuse.
        mockMvc.perform(post("/api/auth/refresh")
                        .cookie(new jakarta.servlet.http.Cookie(REFRESH_COOKIE_NAME, refreshToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("REFRESH_REUSED"));
    }

    @Test
    @DisplayName("signing out works once the access token has expired, which is when it is needed")
    void logoutNeedsOnlyTheRefreshToken() throws Exception {
        Tenant tenant = aTenant();
        MvcResult login = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(tenant.owner().getEmail(), PASSWORD)))
                .andExpect(status().isOk())
                .andReturn();
        String refreshToken = refreshCookieFrom(login);

        // No Authorization header, which is the state of every tab left open longer than fifteen
        // minutes. Behind authenticated() this was a 401 and the controller never ran, so the one
        // credential that actually matters — a seven-day refresh cookie — could not be revoked by
        // the client holding it. The cookie is itself proof of possession: 256 bits, single use,
        // looked up by hash.
        MvcResult loggedOut = mockMvc.perform(post("/api/auth/logout")
                        .cookie(new jakarta.servlet.http.Cookie(REFRESH_COOKIE_NAME, refreshToken)))
                .andExpect(status().isNoContent())
                .andReturn();
        assertThat(loggedOut.getResponse().getHeader(HttpHeaders.SET_COOKIE)).contains("Max-Age=0");

        // And it really is revoked, not merely forgotten by the browser.
        mockMvc.perform(post("/api/auth/refresh")
                        .cookie(new jakarta.servlet.http.Cookie(REFRESH_COOKIE_NAME, refreshToken)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("REFRESH_REUSED"));
    }

    @Test
    @DisplayName("signing out with nothing to sign out of is still a 204")
    void logoutWithoutATokenIsIdempotent() throws Exception {
        // Public now, so this is reachable by anyone — and it has to stay harmless. There is
        // nothing to revoke and nothing to say about it.
        mockMvc.perform(post("/api/auth/logout")).andExpect(status().isNoContent());
    }

    @Test
    @DisplayName("refresh with no token at all is a 401, not a 500")
    void refreshWithoutATokenIsUnauthorised() throws Exception {
        mockMvc.perform(post("/api/auth/refresh"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHENTICATED"));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private RegisterRequest registration() {
        return registration(uniqueSlug(), uniqueEmail());
    }

    private RegisterRequest registration(String slug, String email) {
        return new RegisterRequest("Dana Clinic", slug, "Europe/Paris", "EUR",
                "Dana Okoye", email, PASSWORD);
    }

    private String loginBody(String email, String password) {
        return asJson(new LoginRequest(email, password));
    }

    private String loginResponseBody(String email, String password) throws Exception {
        return mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(email, password)))
                .andExpect(status().isUnauthorized())
                .andReturn()
                .getResponse()
                .getContentAsString();
    }

    private String accessTokenFrom(MvcResult result) throws Exception {
        return json.readTree(result.getResponse().getContentAsString()).get("accessToken").asText();
    }

    private static String uniqueSlug() {
        return "clinic-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static String uniqueEmail() {
        return "owner-" + UUID.randomUUID().toString().substring(0, 8) + "@example.test";
    }
}
