package com.slotflow.security;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Placeholder filter chain for wave 1.
 *
 * <p>There is no authentication in this wave, but {@code spring-boot-starter-security} is on
 * the classpath, and its default chain would put HTTP Basic in front of the health endpoint
 * and Swagger UI. This chain keeps the app open and stateless so the wave-1 demo works, and
 * wires CORS in one place.
 *
 * <p><b>Plan 05 replaces this entirely</b> with the JWT chain and its public allowlist. If
 * this class is still permitting everything when auth lands, that is the bug.
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        return http
                // Resolves the bean *named* corsConfigurationSource. Injecting it by type
                // instead is ambiguous: Spring MVC's mvcHandlerMappingIntrospector is also a
                // CorsConfigurationSource, and the context then fails to start.
                .cors(Customizer.withDefaults())
                // No cookie-based session and no server-rendered forms; CSRF tokens would
                // protect nothing. Revisit in plan 05 when the refresh cookie appears.
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .anyRequest().permitAll())
                .build();
    }

    /**
     * An empty user store, which is the literal truth in this wave: there are no users
     * until plan 05 creates the first one. Declaring it also stops Boot auto-configuring a
     * default user and printing a generated password on every startup — a line that reads
     * like a real credential in the logs and protects nothing here.
     */
    @Bean
    public UserDetailsService userDetailsService() {
        return new InMemoryUserDetailsManager();
    }
}
