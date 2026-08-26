package com.slotflow.demo;

import com.slotflow.security.AuthController;
import com.slotflow.security.AuthResponse;
import com.slotflow.security.LoginRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.context.annotation.Profile;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * {@code POST /api/auth/demo-login} — the button on the landing page.
 *
 * <p>It exists so the SPA can offer one click with <b>no credentials in the JavaScript bundle</b>.
 * That is the entire justification: the demo password is published in the README either way, but a
 * bundle that ships a password teaches every reader of the source the wrong lesson, and it is the
 * pattern that gets copied into a project where the account is real.
 *
 * <h2>Registered under the {@code demo} profile only</h2>
 * Two independent gates, because one of them is not enough. {@code @Profile} decides whether the
 * bean — and therefore the route — exists at all, and {@link com.slotflow.security.SecurityConfig}
 * only adds this path to its anonymous allowlist when the same profile is active. Either alone
 * would work today; together, forgetting one of them in a future edit is still not an
 * unauthenticated session on a production tenant.
 *
 * <h2>It is the login endpoint, not a second way in</h2>
 * The implementation delegates to {@link AuthController#login}, credentials and all, rather than
 * minting tokens of its own. Two things follow, and both are the point:
 *
 * <ul>
 *   <li>every property of a real sign-in holds here — the BCrypt verification actually runs, the
 *       refresh token is issued and rotated the same way, and the {@code Set-Cookie} header carries
 *       the same flags. A token-minting shortcut would be a second issuing path to keep in step
 *       with the first, and the demo is exactly where nobody would notice it had drifted;</li>
 *   <li>if the seeded password and {@link DemoBusiness#OWNER_PASSWORD} ever disagree, this returns
 *       {@code 401} instead of a session — a loud failure of the demo rather than a quiet
 *       divergence between the README and the database.</li>
 * </ul>
 *
 * <p>Calling one controller from another is unusual, and it is deliberate: the alternative is
 * copying the three lines that attach the refresh cookie, and a copy of those is a place where the
 * cookie's {@code SameSite} or {@code Path} can silently stop matching the one the SPA was written
 * against.
 */
@RestController
@Profile("demo")
@Tag(name = "Auth", description = "Registration, sessions and password reset")
public class DemoLoginController {

    private final AuthController auth;

    public DemoLoginController(AuthController auth) {
        this.auth = auth;
    }

    @PostMapping("/api/auth/demo-login")
    @SecurityRequirements
    @Operation(summary = "Sign in as the demo owner",
            description = """
                    Present only when the `demo` profile is active. Takes no body and returns
                    exactly what `POST /api/auth/login` returns for the seeded owner
                    (`demo@slotflow.app`) — an access token, the user, and the refresh token in an
                    httpOnly cookie.

                    The demo tenant is rebuilt from the seeder on every empty database, so nothing
                    a visitor does to it is permanent.""")
    public ResponseEntity<AuthResponse> demoLogin() {
        return auth.login(new LoginRequest(DemoBusiness.OWNER_EMAIL, DemoBusiness.OWNER_PASSWORD));
    }
}
