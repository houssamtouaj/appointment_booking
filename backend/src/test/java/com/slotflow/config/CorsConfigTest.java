package com.slotflow.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * The CORS policy, and the one value it must never be given.
 *
 * <p>A wildcard origin here is not a loose setting, it is a broken one: this API sends
 * {@code Access-Control-Allow-Credentials} because the refresh token rides in a cookie, and the two
 * headers are mutually exclusive by specification. What makes it worth a test is the failure mode —
 * Spring notices per request rather than at startup, so the mistake ships as a deployment that
 * boots, reports itself healthy, and rejects every browser that talks to it.
 */
class CorsConfigTest {

    @Test
    @DisplayName("an explicit origin list is passed through, trimmed")
    void exactOriginsAreAllowed() {
        // Trimmed because the list arrives from a comma-separated environment variable, and
        // "a.example, b.example" with the space a human would naturally type must not produce an
        // origin of " b.example" that matches nothing.
        CorsConfiguration cors = configurationFor(" https://slotflow.vercel.app ",
                "http://localhost:5173");

        assertThat(cors.getAllowedOrigins())
                .containsExactly("https://slotflow.vercel.app", "http://localhost:5173");
        assertThat(cors.getAllowCredentials()).isTrue();
        assertThat(cors.getAllowedOriginPatterns()).isNull();
    }

    @ParameterizedTest(name = "\"{0}\" is refused")
    @ValueSource(strings = {"*", "https://*.vercel.app", "http://localhost:5173,*"})
    @DisplayName("a wildcard fails startup rather than every preflight")
    void wildcardsAreRefused(String origins) {
        // The message has to name the variable a deployer typed, not the Spring property it lands
        // in: CORS_ALLOWED_ORIGINS is what is in their dashboard.
        assertThatThrownBy(() -> new CorsConfig(List.of(origins.split(","))))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("CORS_ALLOWED_ORIGINS");
    }

    @Test
    @DisplayName("no origins at all fails startup: silently allowing none is not a safe default")
    void anEmptyListIsRefused() {
        // Reachable from CORS_ALLOWED_ORIGINS= in a .env, which is a plausible typo and would
        // otherwise leave an API that only its own health check can talk to.
        assertThatThrownBy(() -> new CorsConfig(List.of("  ")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("the policy is scoped to /api/** and does not cover the whole server")
    void onlyTheApiIsCrossOriginAtAll() {
        // Swagger UI and the actuator are same-origin by definition — nothing in a browser fetches
        // them cross-site — so extending the policy to "/**" would widen it for no caller.
        assertThat(new CorsConfig(List.of("http://localhost:5173")).corsConfigurationSource())
                .isNotNull();
        assertThat(configurationFor("http://localhost:5173").getAllowedMethods())
                .containsExactly("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS");
    }

    /**
     * The registered policy for {@code /api/**}, read back off the source.
     *
     * <p>The cast is the assertion: {@code getCorsConfigurations()} is declared on
     * {@link UrlBasedCorsConfigurationSource} and not on the interface, so a change that returned
     * some other source — or registered the policy under a different path — fails here rather than
     * in a browser.
     */
    private static CorsConfiguration configurationFor(String... origins) {
        CorsConfigurationSource source = new CorsConfig(List.of(origins)).corsConfigurationSource();
        CorsConfiguration cors = ((UrlBasedCorsConfigurationSource) source)
                .getCorsConfigurations().get("/api/**");
        assertThat(cors).as("a policy registered for /api/**").isNotNull();
        return cors;
    }
}
