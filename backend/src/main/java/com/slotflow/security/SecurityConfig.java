package com.slotflow.security;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfigurationSource;

/**
 * The filter chain, and the four decisions in it worth defending.
 *
 * <h2>1. The allowlist is enumerated, not prefixed</h2>
 * Plan 05 suggested opening {@code /api/auth/**}. This chain opens five specific paths under it
 * instead, because {@code /api/auth/me} and {@code /api/auth/logout} need a caller. A prefix rule
 * would have left both reachable anonymously and <em>looking</em> fine — {@code /me} would have
 * thrown a null-principal 500 rather than a 401, and it would have been diagnosed as a bug in the
 * controller.
 *
 * <h2>2. Stateless, so CSRF protection would protect nothing — with one exception, handled</h2>
 * There is no session and no server-rendered form. Authorisation on every protected endpoint is the
 * {@code Authorization} header, which a browser never attaches on its own, so the classic CSRF
 * vector does not exist. The exception is the refresh cookie, which a browser <em>would</em> attach:
 * that is why it is {@code SameSite=Lax} and scoped to {@code /api/auth}, which means a cross-site
 * {@code POST} does not carry it at all. The reasoning is in {@link RefreshTokenCookie}; disabling
 * {@code csrf} here is a conclusion, not an omission.
 *
 * <h2>3. 401 and 403 are ours, not Spring's</h2>
 * {@link ProblemAuthenticationEntryPoint} and {@link ProblemAccessDeniedHandler} are wired in
 * explicitly. Without them these two responses — produced inside the filter chain, before the
 * dispatcher exists — would be the only errors in the API that are not RFC 7807 problem details.
 * Plan 04 called this out as the risk it was.
 *
 * <h2>4. Method security is where roles are checked</h2>
 * {@code @EnableMethodSecurity} plus {@code @PreAuthorize("hasRole('OWNER')")} on the owner-only
 * operations, rather than another list of URL patterns here. A rule next to the method it guards
 * cannot drift out of step with a new endpoint, and "OWNER, or STAFF acting on themselves" is a
 * sentence no URL pattern can express.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    /**
     * Everything reachable without a token. Ordered as it reads: sign-up and sign-in, the public
     * booking surface, the Stripe webhook (plan 11 — signature-verified, not token-authenticated),
     * the API documentation, and the liveness probe.
     *
     * <p>{@code /actuator/health} and nothing else from the actuator: {@code /actuator/**} would
     * publish whatever a future dependency decides to register there.
     */
    private static final String[] PUBLIC_PATHS = {
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/refresh",
            "/api/auth/forgot-password",
            "/api/auth/reset-password",
            "/api/public/**",
            "/api/webhooks/stripe",
            "/swagger-ui.html",
            "/swagger-ui/**",
            "/v3/api-docs",
            "/v3/api-docs/**",
            "/actuator/health",
            "/actuator/health/**",
    };

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtService jwtService,
                                           ProblemAuthenticationEntryPoint entryPoint,
                                           ProblemAccessDeniedHandler accessDeniedHandler,
                                           @Qualifier("corsConfigurationSource")
                                           CorsConfigurationSource corsConfigurationSource)
            throws Exception {
        return http
                // Wired from the qualified bean rather than through Customizer.withDefaults().
                // withDefaults() looks up a bean *named* corsConfigurationSource and, when it
                // cannot find one, falls back to Spring MVC's HandlerMappingIntrospector — which
                // carries no CORS mappings at all. Renaming CorsConfig's @Bean method would
                // therefore start the context cleanly, pass every test, and reject every preflight
                // with nothing in the log naming CORS. The qualifier keeps the same by-name
                // resolution — injecting CorsConfigurationSource by type alone is ambiguous,
                // because the introspector is one too — and turns that rename into a startup
                // failure instead.
                .cors(cors -> cors.configurationSource(corsConfigurationSource))
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session ->
                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // No browser login dialog and no login page: this API answers with problem details
                // and the SPA owns the form. Left enabled, either one turns a 401 on an XHR into a
                // redirect or a popup.
                .httpBasic(basic -> basic.disable())
                .formLogin(form -> form.disable())
                .logout(logout -> logout.disable())
                .exceptionHandling(handling -> handling
                        .authenticationEntryPoint(entryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .authorizeHttpRequests(auth -> auth
                        // CORS preflights carry no credentials by definition, so they have to pass
                        // before authorisation or every cross-origin request fails at the preflight.
                        .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        .anyRequest().authenticated())
                // Before the (disabled) username/password filter, which is simply the conventional
                // anchor point for "where authentication happens" in the chain.
                .addFilterBefore(new JwtAuthenticationFilter(jwtService),
                        UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    /**
     * BCrypt, at a cost read from configuration.
     *
     * <p>Twelve in production: roughly a quarter of a second per verification, which is the point —
     * it makes an offline attack on a stolen table expensive and an online one rate-limited into
     * irrelevance ({@code RateLimitFilter} runs ahead of this on purpose). The suite drops it to the
     * minimum, because a test class that logs in forty times would otherwise spend ten seconds
     * proving nothing about cost factors.
     */
    @Bean
    public PasswordEncoder passwordEncoder(AuthProperties properties) {
        return new BCryptPasswordEncoder(properties.bcryptStrength());
    }

    /**
     * Users are authenticated by {@link AuthService} against {@code app_user}, so there is no
     * {@code UserDetailsService} in this design — but declaring one is not pointless. Without any
     * such bean Boot auto-configures a default in-memory user and prints a generated password on
     * every startup: a line that reads like a real credential and protects nothing. This makes the
     * absence deliberate and the log quiet.
     */
    @Bean
    public UserDetailsService userDetailsService() {
        return username -> {
            throw new UsernameNotFoundException(
                    "authentication goes through AuthService, not a UserDetailsService");
        };
    }
}
