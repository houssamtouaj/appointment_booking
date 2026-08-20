package com.slotflow.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.slotflow.common.error.ProblemDetailWriter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.skyscreamer.jsonassert.JSONAssert;
import org.skyscreamer.jsonassert.JSONCompareMode;
import org.springframework.http.MediaType;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.InsufficientAuthenticationException;

/**
 * The two responses Spring Security writes by itself, asserted strictly.
 *
 * <p>This is the plan-04 risk closed and kept closed. The security filter chain finishes with a
 * request before the {@code DispatcherServlet} ever sees it, so a 401 or a 403 raised inside it
 * cannot reach {@code @RestControllerAdvice} — and Spring's defaults are an empty body with a
 * {@code WWW-Authenticate} header. Without the two components under test, those would be the only
 * error responses in this API that a client cannot parse the same way as the rest.
 *
 * <p>A unit test rather than a slice test, because what is being asserted is the bytes. The
 * {@code ObjectMapper} comes from {@link Jackson2ObjectMapperBuilder} for one specific reason: it
 * registers Spring's {@code ProblemDetail} mixin, which is what makes {@code code} appear as a
 * top-level member instead of nested under {@code properties}. A bare {@code new ObjectMapper()}
 * would produce a body no client of ours would recognise, and the test would be asserting fiction.
 */
class FilterChainProblemBodyTest {

    private final ObjectMapper objectMapper = Jackson2ObjectMapperBuilder.json().build();
    private final ProblemDetailWriter writer = new ProblemDetailWriter(objectMapper);

    @Test
    @DisplayName("an unauthenticated request gets the same problem body as everything else")
    void entryPointWritesTheProblemShape() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new ProblemAuthenticationEntryPoint(writer).commence(
                requestFor("/api/staff"), response,
                new InsufficientAuthenticationException("no token"));

        assertThat(response.getStatus()).isEqualTo(401);
        assertThat(response.getContentType())
                .isEqualTo(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
        JSONAssert.assertEquals("""
                {
                  "type": "https://slotflow.dev/problems/unauthenticated",
                  "title": "Authentication required",
                  "status": 401,
                  "detail": "Authentication is required to access this resource.",
                  "instance": "/api/staff",
                  "code": "UNAUTHENTICATED"
                }
                """, response.getContentAsString(), JSONCompareMode.STRICT);
    }

    @Test
    @DisplayName("a request the chain refuses gets the 403 in the same shape")
    void accessDeniedHandlerWritesTheProblemShape() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new ProblemAccessDeniedHandler(writer).handle(
                requestFor("/api/staff/invite"), response,
                new AccessDeniedException("owner only"));

        assertThat(response.getStatus()).isEqualTo(403);
        JSONAssert.assertEquals("""
                {
                  "type": "https://slotflow.dev/problems/access-denied",
                  "title": "Access denied",
                  "status": 403,
                  "detail": "You do not have permission to perform this action.",
                  "instance": "/api/staff/invite",
                  "code": "ACCESS_DENIED"
                }
                """, response.getContentAsString(), JSONCompareMode.STRICT);
    }

    @Test
    @DisplayName("neither body says anything about why, or about what exists")
    void bodiesLeakNothing() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        new ProblemAuthenticationEntryPoint(writer).commence(
                requestFor("/api/staff"), response,
                new InsufficientAuthenticationException("token expired at 09:15 for dana@example.test"));

        // The exception message is for the log, never for the caller: "expired" versus "forged"
        // versus "absent" is information an attacker can use and a client cannot.
        assertThat(response.getContentAsString())
                .doesNotContain("expired")
                .doesNotContain("dana@example.test");
    }

    private static MockHttpServletRequest requestFor(String uri) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", uri);
        request.setRequestURI(uri);
        return request;
    }
}
