package com.slotflow.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Turns an {@code Authorization: Bearer <jwt>} header into an authenticated
 * {@link org.springframework.security.core.context.SecurityContext}, and does nothing else.
 *
 * <p>Two properties of that "nothing else" matter:
 *
 * <ul>
 *   <li><b>An absent or unusable token is not an error here.</b> The filter leaves the context
 *       empty and lets the chain continue; whether that is acceptable is
 *       {@code authorizeHttpRequests}' decision, and the 401 body is
 *       {@link ProblemAuthenticationEntryPoint}'s. A filter that answered 401 itself would break
 *       every public endpoint the moment a browser sent a stale header.</li>
 *   <li><b>No database access.</b> The signature is the whole check. That is what makes an
 *       authenticated request cost nothing extra, and it is why deactivation takes effect on the
 *       next refresh rather than on the next request — see {@link AuthPrincipal}.</li>
 * </ul>
 *
 * <p>Registered inside the security chain by {@link SecurityConfig}, not as a servlet filter bean:
 * a {@code @Component} extending {@code OncePerRequestFilter} would otherwise also be picked up by
 * Boot's filter registration and run twice, once outside the chain where its ordering relative to
 * the entry point is undefined.
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER_PREFIX = "Bearer ";

    private final JwtService jwtService;

    public JwtAuthenticationFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String token = bearerToken(request);
        // Never overwrite an existing authentication: in a test that used @WithMockUser, or behind
        // any earlier authentication mechanism, silently replacing it would be baffling.
        if (token != null && SecurityContextHolder.getContext().getAuthentication() == null) {
            AuthPrincipal principal = jwtService.parse(token);
            if (principal != null) {
                SecurityContextHolder.getContext().setAuthentication(new JwtAuthentication(principal));
            }
        }
        chain.doFilter(request, response);
    }

    private static String bearerToken(HttpServletRequest request) {
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        if (header == null || !header.regionMatches(true, 0, BEARER_PREFIX, 0, BEARER_PREFIX.length())) {
            return null;
        }
        String token = header.substring(BEARER_PREFIX.length()).trim();
        return token.isEmpty() ? null : token;
    }
}
