package com.slotflow.common.web;

import com.slotflow.common.error.ErrorCode;
import com.slotflow.common.error.ProblemDetailWriter;
import com.slotflow.common.error.Problems;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.ProblemDetail;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.util.UrlPathHelper;

/**
 * Rate limits the endpoints that create rows and send mail without any authentication (D12).
 *
 * <p>Unauthenticated writes are the first thing a technical reviewer probes, and the booking
 * endpoint in particular turns one HTTP request into a database row and an outbound email.
 *
 * <p>It runs ahead of Spring Security so a login flood is rejected before any password hashing
 * happens: BCrypt at strength 12 is deliberately expensive, which makes an unlimited login
 * endpoint a CPU amplifier. Because it runs outside the dispatcher there is no
 * {@code @ControllerAdvice} yet, so the 429 body is written through
 * {@link ProblemDetailWriter} to keep it identical to every other error in the API.
 */
@Component
@Order(RateLimitFilter.ORDER)
public class RateLimitFilter extends OncePerRequestFilter {

    /** After request correlation, so the rejection is logged with an id; before security. */
    public static final int ORDER = RequestCorrelationFilter.ORDER + 5;

    /**
     * Decodes {@code %xx}, strips matrix parameters and collapses duplicate slashes — the same
     * normalisation the dispatcher applies before it picks a handler. Matching the raw
     * {@code getRequestURI()} instead is a bypass rather than an untidiness:
     * {@code /api/auth/%6Cogin} and {@code /api/auth/login;x=1} both reach the real login handler,
     * and neither is equal to the literal below, so a caller rotating encodings gets an unlimited
     * login endpoint — which, in front of BCrypt at strength 12, is exactly the CPU amplifier
     * this filter exists to close.
     */
    private static final UrlPathHelper PATHS = UrlPathHelper.defaultInstance;

    private static final String LOGIN_PATH = "/api/auth/login";
    private static final String AUTH_PREFIX = "/api/auth/";
    private static final String PUBLIC_PREFIX = "/api/public/";

    private final RateLimiter rateLimiter;
    private final ProblemDetailWriter problemWriter;

    public RateLimitFilter(RateLimiter rateLimiter, ProblemDetailWriter problemWriter) {
        this.rateLimiter = rateLimiter;
        this.problemWriter = problemWriter;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain chain) throws ServletException, IOException {
        RateLimiter.Scope scope = scopeFor(request);
        if (scope == null) {
            chain.doFilter(request, response);
            return;
        }

        RateLimiter.Decision decision = rateLimiter.tryConsume(scope, clientIp(request));
        if (decision.allowed()) {
            chain.doFilter(request, response);
            return;
        }

        ProblemDetail problem = Problems.of(ErrorCode.RATE_LIMITED,
                "Too many requests. Try again in %d second(s)."
                        .formatted(decision.retryAfterSeconds()));
        Problems.setInstance(problem, request.getRequestURI());
        // Advisory but expected: without it a client has to guess, and guessing means retrying
        // immediately and burning the next token the moment it appears.
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(decision.retryAfterSeconds()));
        problemWriter.write(response, problem);
    }

    /** {@code null} means "not a limited endpoint": most traffic takes this branch. */
    private static RateLimiter.Scope scopeFor(HttpServletRequest request) {
        String path = PATHS.getPathWithinApplication(request);
        if (HttpMethod.POST.matches(request.getMethod()) && LOGIN_PATH.equals(path)) {
            return RateLimiter.Scope.LOGIN;
        }
        if (isWrite(request.getMethod())
                && (path.startsWith(AUTH_PREFIX) || path.startsWith(PUBLIC_PREFIX))) {
            return RateLimiter.Scope.PUBLIC_WRITE;
        }
        return null;
    }

    /**
     * Reads only public endpoints, which are cheap and cacheable. Limiting them too would throttle
     * the booking page's own calendar polling and buy nothing.
     */
    private static boolean isWrite(String method) {
        return HttpMethod.POST.matches(method)
                || HttpMethod.PUT.matches(method)
                || HttpMethod.PATCH.matches(method)
                || HttpMethod.DELETE.matches(method);
    }

    /**
     * Deliberately {@code getRemoteAddr()} and not an {@code X-Forwarded-For} parse. Trusting
     * that header when nothing strips it lets any caller rotate a fake IP per request and opt
     * out of the limit entirely. Behind a proxy, {@code server.forward-headers-strategy}
     * makes this method return the forwarded address, and that is a deployment decision rather
     * than a hard-coded assumption in a filter.
     */
    private static String clientIp(HttpServletRequest request) {
        String remoteAddr = request.getRemoteAddr();
        return remoteAddr == null ? "unknown" : remoteAddr;
    }
}
