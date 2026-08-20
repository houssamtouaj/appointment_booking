package com.slotflow.common.web;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.slf4j.MDC;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/**
 * The correlation id: generated when absent, echoed when sane, replaced when it is not, and
 * always unbound from the thread on the way out.
 */
class RequestCorrelationFilterTest {

    private final RequestCorrelationFilter filter = new RequestCorrelationFilter();

    @Test
    @DisplayName("a request without the header gets a generated id, echoed on the response")
    void generatesAnIdWhenTheCallerSendsNone() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(new MockHttpServletRequest("GET", "/api/public/businesses/demo"),
                response, new MockFilterChain());

        String echoed = response.getHeader(RequestCorrelation.HEADER);
        assertThat(echoed).isNotBlank();
        assertThat(UUID.fromString(echoed)).isNotNull();
    }

    @Test
    @DisplayName("a caller-supplied id is kept, so a trace spans the SPA and the API")
    void echoesACallerSuppliedId() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/services");
        request.addHeader(RequestCorrelation.HEADER, "spa-7f3a9c");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getHeader(RequestCorrelation.HEADER)).isEqualTo("spa-7f3a9c");
    }

    @Test
    @DisplayName("an id with a newline in it is discarded: that header lands in the log file")
    void rejectsAnUnsafeId() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/services");
        request.addHeader(RequestCorrelation.HEADER, "evil\nWARN  fake log line");
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getHeader(RequestCorrelation.HEADER))
                .doesNotContain("fake log line")
                .doesNotContain("\n");
    }

    @Test
    @DisplayName("an absurdly long id is discarded rather than written to every log line")
    void rejectsAnOversizedId() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/services");
        request.addHeader(RequestCorrelation.HEADER, "x".repeat(500));
        MockHttpServletResponse response = new MockHttpServletResponse();

        filter.doFilter(request, response, new MockFilterChain());

        assertThat(response.getHeader(RequestCorrelation.HEADER)).hasSizeLessThan(500);
    }

    @Test
    @DisplayName("the id is visible during the request and gone afterwards")
    void bindsAndUnbindsTheMdc() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/services");
        request.addHeader(RequestCorrelation.HEADER, "inside-the-request");
        FilterChain assertingChain = (req, res) ->
                assertThat(RequestCorrelation.current()).isEqualTo("inside-the-request");

        filter.doFilter(request, new MockHttpServletResponse(), assertingChain);

        // Tomcat reuses threads. A leaked id would stamp this request's token onto the next one.
        assertThat(MDC.get(RequestCorrelation.MDC_KEY)).isNull();
    }

    @Test
    @DisplayName("the MDC is cleaned up even when the request blows up")
    void unbindsAfterAFailure() {
        FilterChain failingChain = (req, res) -> {
            throw new IllegalStateException("handler exploded");
        };

        try {
            filter.doFilter(new MockHttpServletRequest("GET", "/api/services"),
                    new MockHttpServletResponse(), failingChain);
        } catch (Exception expected) {
            // the point of the test is what happens in the finally block, not the throw
        }

        assertThat(MDC.get(RequestCorrelation.MDC_KEY)).isNull();
    }
}
