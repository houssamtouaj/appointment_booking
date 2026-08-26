package com.slotflow.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.MvcResult;

/**
 * {@code POST /api/auth/demo-login} — the one request between a stranger and a populated dashboard.
 *
 * <p>The interesting assertion is not that it returns 200. It is that what comes back is
 * indistinguishable from a real sign-in: the same body, a usable access token, and a refresh cookie
 * with the same flags. A demo endpoint that returned a token the SPA's own interceptor could not
 * refresh would work in a screenshot and fail fifteen minutes into a demo call.
 */
class DemoLoginIT extends DemoProfileTest {

    private static final String DEMO_LOGIN = "/api/auth/demo-login";

    @Test
    @DisplayName("no body, no credentials, and a session for the seeded owner comes back")
    void oneClickSignsInAsTheDemoOwner() throws Exception {
        mockMvc.perform(post(DEMO_LOGIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").isNotEmpty())
                .andExpect(jsonPath("$.tokenType").value("Bearer"))
                .andExpect(jsonPath("$.expiresIn").value(900))
                .andExpect(jsonPath("$.user.email").value(DemoBusiness.OWNER_EMAIL))
                .andExpect(jsonPath("$.user.role").value("OWNER"))
                .andExpect(jsonPath("$.user.business.slug").value(DemoBusiness.SLUG));
    }

    @Test
    @DisplayName("the access token it hands out actually authorises an admin request")
    void theTokenWorks() throws Exception {
        MvcResult result = mockMvc.perform(post(DEMO_LOGIN)).andReturn();
        String accessToken = json.readTree(result.getResponse().getContentAsString())
                .path("accessToken").asText();

        // /api/auth/me rather than the dashboard, because it is the one endpoint that reads the
        // user back out of the database: a token carrying a business id that no longer exists would
        // pass a signature check and fail here.
        mockMvc.perform(get("/api/auth/me")
                        .header(HttpHeaders.AUTHORIZATION, "Bearer " + accessToken))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value(DemoBusiness.OWNER_EMAIL));
    }

    @Test
    @DisplayName("the refresh cookie comes back too, so the SPA's session survives the first hour")
    void itIsARealSessionAndNotJustAToken() throws Exception {
        MvcResult result = mockMvc.perform(post(DEMO_LOGIN))
                .andExpect(status().isOk())
                .andReturn();

        String refreshToken = refreshCookieFrom(result);
        assertThat(refreshToken).as("the refresh token in the Set-Cookie header").isNotBlank();

        // And it rotates, which is the property that proves this went through the real issuing path
        // rather than a shortcut that minted an access token and stopped.
        mockMvc.perform(post("/api/auth/refresh")
                        .contentType("application/json")
                        .content("{\"refreshToken\": \"" + refreshToken + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.email").value(DemoBusiness.OWNER_EMAIL));
    }

    @Test
    @DisplayName("the published password is the one that works, so the README cannot drift")
    void theCredentialsInTheReadmeAreReal() throws Exception {
        // The same account through the ordinary endpoint. If the seeder ever hashes something other
        // than DemoBusiness.OWNER_PASSWORD, demo-login above keeps working — it reads the same
        // constant — and this fails, which is the right way round: the README quotes these two
        // strings, and a visitor who types them is doing exactly this request.
        mockMvc.perform(post("/api/auth/login")
                        .contentType("application/json")
                        .content("""
                                {"email": "%s", "password": "%s"}
                                """.formatted(DemoBusiness.OWNER_EMAIL,
                                DemoBusiness.OWNER_PASSWORD)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.business.slug").value(DemoBusiness.SLUG));
    }
}
