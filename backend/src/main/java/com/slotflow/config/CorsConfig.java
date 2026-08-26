package com.slotflow.config;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * CORS for the Vite dev server plus whatever origins production is served from.
 *
 * <p>Credentials are enabled because the refresh token rides in an httpOnly cookie
 * (plan 05), which also rules out a wildcard origin: origins are always an explicit list.
 * The bean name matters: Spring Security's {@code http.cors(Customizer.withDefaults())}
 * looks up a bean called {@code corsConfigurationSource} by name, so this is the single
 * place CORS is configured.
 *
 * <h2>Why the wildcard is refused here rather than left to Spring</h2>
 * {@code allowCredentials=true} with {@code Access-Control-Allow-Origin: *} is illegal, and Spring
 * does reject it — but it rejects it <em>per request</em>, from inside the CORS processor. So a
 * deployment that sets {@code CORS_ALLOWED_ORIGINS=*} starts cleanly, passes its health check, and
 * fails every browser preflight with an exception that names {@code allowCredentials} rather than
 * the variable somebody typed. Failing at startup turns that into a container that will not boot
 * and a message naming the fix, which is the only version of this a deployer can act on.
 */
@Configuration
public class CorsConfig {

    private static final String PROPERTY = "app.cors.allowed-origins";

    /**
     * Named in both failure messages alongside the property. A deployer reading a crashed
     * container's log has an environment variable in a dashboard, not a Spring property in a YAML
     * file they may never have opened — so a message naming only the latter tells them what is
     * wrong and not where to fix it.
     */
    private static final String VARIABLE = "CORS_ALLOWED_ORIGINS";

    private final List<String> allowedOrigins;

    public CorsConfig(@Value("${app.cors.allowed-origins}") List<String> allowedOrigins) {
        this.allowedOrigins = validated(allowedOrigins);
    }

    /**
     * An explicit, non-empty list of exact origins.
     *
     * <p>Patterns are refused along with the bare wildcard, and that is not over-reach: Spring's
     * {@code allowedOriginPatterns} exists precisely to permit credentialed wildcards by echoing the
     * caller's origin back, so {@code https://*.example.com} in this list would look like a
     * tightening and behave like a widening. If a deploy ever genuinely needs per-branch preview
     * origins, that is a decision to record and a different setter to call, not a character to slip
     * into a comma-separated list.
     */
    private static List<String> validated(List<String> origins) {
        List<String> trimmed = origins == null ? List.of()
                : origins.stream().map(String::trim).filter(origin -> !origin.isEmpty()).toList();
        if (trimmed.isEmpty()) {
            throw new IllegalStateException(PROPERTY + " must list at least one origin; set "
                    + VARIABLE + " to the frontend's origin, plus localhost for development");
        }
        trimmed.stream().filter(origin -> origin.contains("*")).findFirst().ifPresent(origin -> {
            throw new IllegalStateException(PROPERTY + " (" + VARIABLE + ") must not contain a "
                    + "wildcard, and \"" + origin + "\" does. The refresh token travels in a "
                    + "cookie, so this API sends Access-Control-Allow-Credentials, and a wildcard "
                    + "origin is illegal with it. List the exact origins, comma-separated.");
        });
        return trimmed;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration cors = new CorsConfiguration();
        cors.setAllowedOrigins(allowedOrigins);
        cors.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "Accept", "Idempotency-Key"));
        cors.setExposedHeaders(List.of("Location", "Retry-After"));
        cors.setAllowCredentials(true);
        cors.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", cors);
        return source;
    }
}
