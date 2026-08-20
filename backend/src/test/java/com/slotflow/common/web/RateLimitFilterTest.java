package com.slotflow.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.slotflow.common.error.ProblemDetailWriter;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * D12, at the level where it is actually decidable: which requests are limited, what a rejection
 * looks like, and that the budgets do not bleed into each other.
 *
 * <p>No Spring context and no clock manipulation. The limits under test are two requests wide, so
 * the third call is the assertion — a test that waited for a real refill window would be a
 * minute-long test and a future flake.
 */
class RateLimitFilterTest {

    private static final String CLIENT_IP = "203.0.113.7";

    private RateLimitFilter filter;

    @BeforeEach
    void setUp() {
        RateLimitProperties properties = new RateLimitProperties(
                true,
                new RateLimitProperties.Limit(2, Duration.ofMinutes(1)),
                new RateLimitProperties.Limit(2, Duration.ofMinutes(1)),
                new RateLimitProperties.Limit(2, Duration.ofHours(1)));
        filter = new RateLimitFilter(
                new RateLimiter(properties), new ProblemDetailWriter(new ObjectMapper()));
    }

    @Test
    @DisplayName("exceeding the login limit returns 429 with a problem body and Retry-After")
    void loginLimitReturns429WithRetryAfter() throws Exception {
        assertThat(callStatus("POST", "/api/auth/login")).isEqualTo(HttpStatus.OK.value());
        assertThat(callStatus("POST", "/api/auth/login")).isEqualTo(HttpStatus.OK.value());

        MockHttpServletResponse rejected = call("POST", "/api/auth/login", CLIENT_IP);

        assertThat(rejected.getStatus()).isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
        assertThat(rejected.getContentType()).isEqualTo(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        assertThat(rejected.getContentAsString())
                .contains("\"code\":\"RATE_LIMITED\"")
                .contains("\"status\":429")
                .contains("\"type\":\"https://slotflow.dev/problems/rate-limited\"")
                .contains("\"instance\":\"/api/auth/login\"");
        // Never 0: a Retry-After of zero invites the immediate retry that fails again.
        assertThat(Integer.parseInt(rejected.getHeader(HttpHeaders.RETRY_AFTER))).isPositive();
    }

    @Test
    @DisplayName("the login budget is separate from the public-write budget")
    void loginAndPublicWriteDoNotShareABudget() throws Exception {
        callStatus("POST", "/api/auth/login");
        callStatus("POST", "/api/auth/login");
        assertThat(callStatus("POST", "/api/auth/login"))
                .as("login budget should now be spent")
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());

        // A booking attempt must not be collateral damage of somebody else's login attempts:
        // one shared bucket would let a credential-stuffing run close the booking page.
        assertThat(callStatus("POST", "/api/public/businesses/demo/bookings"))
                .isEqualTo(HttpStatus.OK.value());
    }

    @Test
    @DisplayName("the budget is per client IP, so one noisy caller cannot lock everyone out")
    void budgetsArePerClientIp() throws Exception {
        call("POST", "/api/public/businesses/demo/bookings", CLIENT_IP);
        call("POST", "/api/public/businesses/demo/bookings", CLIENT_IP);
        assertThat(call("POST", "/api/public/businesses/demo/bookings", CLIENT_IP).getStatus())
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());

        assertThat(call("POST", "/api/public/businesses/demo/bookings", "198.51.100.4").getStatus())
                .isEqualTo(HttpStatus.OK.value());
    }

    @Test
    @DisplayName("a percent-encoded login path spends the login budget like any other")
    void encodedLoginPathIsStillTheLoginPath() throws Exception {
        // Spring decodes each path segment before it chooses a handler, so /api/auth/%6Cogin
        // reaches the real login endpoint. A limiter comparing the raw URI would wave every one of
        // these through, and an attacker rotating encodings would have an unlimited endpoint in
        // front of BCrypt.
        assertThat(callStatus("POST", "/api/auth/%6Cogin")).isEqualTo(HttpStatus.OK.value());
        assertThat(callStatus("POST", "/api/auth/login")).isEqualTo(HttpStatus.OK.value());

        assertThat(callStatus("POST", "/api/auth/%6Cogin"))
                .as("the encoded spelling must share the budget, not have one of its own")
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    @DisplayName("matrix parameters do not buy a fresh login budget either")
    void matrixParametersAreStrippedBeforeMatching() throws Exception {
        // The dispatcher treats `;name=value` as segment parameters and strips them; an exact
        // match against the raw URI does not.
        assertThat(callStatus("POST", "/api/auth/login;x=1")).isEqualTo(HttpStatus.OK.value());
        assertThat(callStatus("POST", "/api/auth/login")).isEqualTo(HttpStatus.OK.value());

        assertThat(callStatus("POST", "/api/auth/login;x=2"))
                .isEqualTo(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    @Test
    @DisplayName("public reads are never limited: the booking calendar polls them")
    void readsPassThrough() throws Exception {
        for (int attempt = 0; attempt < 10; attempt++) {
            assertThat(callStatus("GET", "/api/public/businesses/demo/availability"))
                    .isEqualTo(HttpStatus.OK.value());
        }
    }

    @Test
    @DisplayName("authenticated admin writes are not limited: they have a token to hold them to account")
    void adminWritesPassThrough() throws Exception {
        for (int attempt = 0; attempt < 10; attempt++) {
            assertThat(callStatus("POST", "/api/services")).isEqualTo(HttpStatus.OK.value());
        }
    }

    @Test
    @DisplayName("with the limiter switched off nothing is rejected, whatever the traffic")
    void disabledLimiterLetsEverythingThrough() throws Exception {
        // The limits are present but irrelevant: `enabled: false` returns before any bucket is
        // consulted. Not null, because the properties record refuses a missing limit rather than
        // inventing one.
        RateLimitProperties.Limit unused = new RateLimitProperties.Limit(1, Duration.ofMinutes(1));
        RateLimitFilter disabled = new RateLimitFilter(
                new RateLimiter(new RateLimitProperties(false, unused, unused, unused)),
                new ProblemDetailWriter(new ObjectMapper()));

        for (int attempt = 0; attempt < 20; attempt++) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            disabled.doFilter(request("POST", "/api/auth/login", CLIENT_IP), response,
                    new MockFilterChain());
            assertThat(response.getStatus()).isEqualTo(HttpStatus.OK.value());
        }
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private int callStatus(String method, String path) throws Exception {
        return call(method, path, CLIENT_IP).getStatus();
    }

    private MockHttpServletResponse call(String method, String path, String clientIp)
            throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request(method, path, clientIp), response, new MockFilterChain());
        return response;
    }

    private static MockHttpServletRequest request(String method, String path, String clientIp) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        request.setRemoteAddr(clientIp);
        return request;
    }
}
