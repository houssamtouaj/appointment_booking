package com.slotflow.common.web;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Puts a request id in the MDC and echoes it as {@code X-Request-Id}.
 *
 * <p>It sits ahead of everything, Spring Security's chain included, so a 401 produced deep
 * inside that chain is still correlated with its log lines. The header is set before the chain
 * runs rather than after: a handler further down may commit the response, and a header added
 * to a committed response is silently dropped.
 */
@Component
@Order(RequestCorrelationFilter.ORDER)
public class RequestCorrelationFilter extends OncePerRequestFilter {

    /**
     * Ahead of the security chain (-100) and of everything else we register, but behind Boot's
     * {@code ForwardedHeaderFilter}, which runs at the highest precedence when
     * {@code server.forward-headers-strategy} is set. Order matters there: the rate limiter
     * downstream reads the client IP, and it must read the one the proxy forwarded.
     */
    public static final int ORDER = Ordered.HIGHEST_PRECEDENCE + 5;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String requestId = RequestCorrelation.sanitiseOrGenerate(
                request.getHeader(RequestCorrelation.HEADER));
        RequestCorrelation.bind(requestId);
        response.setHeader(RequestCorrelation.HEADER, requestId);
        try {
            chain.doFilter(request, response);
        } finally {
            // Tomcat pools its threads. Leaving the id bound would stamp it on whatever
            // request lands on this thread next, which is worse than having no id at all.
            RequestCorrelation.unbind();
        }
    }
}
