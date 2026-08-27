package com.slotflow.security;

import java.util.Arrays;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
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
 * Plan 05 suggested opening {@code /api/auth/**}. This chain opens six specific paths under it
 * instead, because {@code /api/auth/me} needs a caller: a prefix rule would leave it reachable
 * anonymously and <em>looking</em> fine, throwing a null-principal 500 rather than a 401, which
 * would then be diagnosed as a bug in the controller.
 *
 * <p>{@code /api/auth/logout} is on the list, and that is a change of mind worth recording.
 * Requiring an access token there means sign-out stops working exactly when it is most needed:
 * fifteen minutes into a forgotten tab the access token is expired, the client still holds a
 * seven-day refresh cookie, and {@code POST /logout} answers 401 without the controller ever
 * running — so the one credential that matters cannot be revoked by the client that has it. The
 * refresh token in the same request is the proof of possession: 256 bits, single use, looked up by
 * hash, and {@code AuthController#logout} already tolerates a missing or stale one by answering
 * 204. Requiring a <em>second</em> credential to give up the first buys nothing, and costs the SPA
 * a refresh-then-logout dance on every sign-out path.
 *
 * <h2>2. Stateless, so CSRF protection would protect nothing — with one exception, handled</h2>
 * There is no session and no server-rendered form. Authorisation on every protected endpoint is the
 * {@code Authorization} header, which a browser never attaches on its own, so the classic CSRF
 * vector does not exist. The exception is the refresh cookie, which a browser <em>would</em> attach:
 * that is why it is {@code SameSite=Lax} by default and scoped to {@code /api/auth}, which means a
 * cross-site {@code POST} does not carry it at all. A cross-site deployment has to relax that to
 * {@code SameSite=None}, and {@link RefreshTokenCookie} sets out exactly what that trades away —
 * an unobservable forced rotation or logout, and nothing wider. The reasoning is there; disabling
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
     *
     * <p>Every write under {@code /api/auth/} is inside the rate limiter's {@code PUBLIC_WRITE}
     * budget whether it is listed here or not ({@code RateLimitFilter} runs ahead of this chain),
     * so opening a path does not open it to unlimited traffic.
     */
    private static final String[] PUBLIC_PATHS = {
            "/api/auth/register",
            "/api/auth/login",
            "/api/auth/refresh",
            // Authenticated by the refresh token it presents, not by an access token; see the
            // class note. /api/auth/me is deliberately absent from this list.
            "/api/auth/logout",
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

    /**
     * The demo profile's one-click sign-in, kept out of {@link #PUBLIC_PATHS} on purpose.
     *
     * <p>{@code POST /api/auth/demo-login} hands out a session for a real tenant with no credential
     * presented, so it must not be openable by a deployment that merely forgot to think about it.
     * Listing it above would open the path in every environment — harmless while the controller is
     * {@code @Profile("demo")} and absent, and a genuine hole the moment somebody drops that
     * annotation for a local experiment. Here, the two have to be wrong together.
     */
    private static final String DEMO_LOGIN_PATH = "/api/auth/demo-login";

    private static final String DEMO_PROFILE = "demo";

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http, JwtService jwtService,
            ProblemAuthenticationEntryPoint entryPoint,
            ProblemAccessDeniedHandler accessDeniedHandler,
            Environment environment,
            @Qualifier("corsConfigurationSource") CorsConfigurationSource corsConfigurationSource)
            throws Exception {
        String[] publicPaths = publicPaths(environment);
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
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
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
                        .requestMatchers(publicPaths).permitAll()
                        .anyRequest().authenticated())
                // Before the (disabled) username/password filter, which is simply the conventional
                // anchor point for "where authentication happens" in the chain.
                .addFilterBefore(new JwtAuthenticationFilter(jwtService),
                        UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    /**
     * The allowlist for this environment: the constant above, plus the demo sign-in when and only
     * when the {@code demo} profile is active.
     */
    private static String[] publicPaths(Environment environment) {
        if (!environment.matchesProfiles(DEMO_PROFILE)) {
            return PUBLIC_PATHS;
        }
        String[] paths = Arrays.copyOf(PUBLIC_PATHS, PUBLIC_PATHS.length + 1);
        paths[PUBLIC_PATHS.length] = DEMO_LOGIN_PATH;
        return paths;
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
