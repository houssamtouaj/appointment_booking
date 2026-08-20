package com.slotflow.security;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The seven endpoints under {@code /api/auth}.
 *
 * <p>Thin by design: every decision is in {@link AuthService}, and the one thing that genuinely
 * belongs here is the {@code Set-Cookie} header — the refresh token's transport, which is settled
 * and argued in {@link RefreshTokenCookie}.
 *
 * <p>Five of these are public and two are not, which is why {@link SecurityConfig} allowlists the
 * five individually rather than the whole {@code /api/auth/**} prefix: {@code /me} and
 * {@code /logout} need a caller, and a prefix rule that quietly included them would be a hole
 * nobody notices, because both would still appear to work.
 */
@RestController
@RequestMapping("/api/auth")
@Tag(name = "Auth", description = "Registration, sessions and password reset")
public class AuthController {

    private final AuthService authService;
    private final RefreshTokenCookie refreshCookie;

    public AuthController(AuthService authService, RefreshTokenCookie refreshCookie) {
        this.authService = authService;
        this.refreshCookie = refreshCookie;
    }

    @PostMapping("/register")
    @SecurityRequirements
    @Operation(summary = "Register a business",
            description = """
                    Creates the business, its default booking policy and its owner in one
                    transaction, then signs the owner in. A taken slug is 409 SLUG_TAKEN and a
                    taken email address is 409 EMAIL_TAKEN, so the sign-up form can say which
                    field to change.""")
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        return withRefreshCookie(HttpStatus.CREATED, authService.register(request));
    }

    @PostMapping("/login")
    @SecurityRequirements
    @Operation(summary = "Sign in",
            description = """
                    Returns an access token in the body and a refresh token in an httpOnly cookie.
                    An unknown address, a wrong password and a deactivated account all return the
                    same 401 body, deliberately.""")
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        return withRefreshCookie(HttpStatus.OK, authService.login(request));
    }

    /**
     * Rotates the refresh token. The presented one is revoked and linked to its successor, so
     * presenting it again is treated as theft and ends every session the user has
     * ({@code 401 REFRESH_REUSED}) — see {@link RefreshTokenService}.
     */
    @PostMapping("/refresh")
    @SecurityRequirements
    @Operation(summary = "Rotate the refresh token",
            description = """
                    Reads the refresh token from the httpOnly cookie, or from the request body for
                    non-browser clients. Presenting an already-rotated token returns
                    401 REFRESH_REUSED and revokes every other refresh token for that user.""")
    public ResponseEntity<AuthResponse> refresh(
            @CookieValue(name = RefreshTokenCookie.NAME, required = false) String cookieToken,
            @RequestBody(required = false) RefreshRequest body) {
        return withRefreshCookie(HttpStatus.OK,
                authService.refresh(presentedToken(cookieToken, body)));
    }

    /**
     * Revokes the presented refresh token and clears the cookie. Authenticated, so a stray request
     * cannot end someone else's session by guessing — though guessing a 256-bit token is the harder
     * half of that sentence.
     */
    @PostMapping("/logout")
    @Operation(summary = "Sign out",
            description = """
                    Revokes the presented refresh token and clears the cookie. The access token
                    keeps working until it expires; that 15-minute window is a deliberate trade for
                    stateless verification on every request.""")
    public ResponseEntity<Void> logout(
            @CookieValue(name = RefreshTokenCookie.NAME, required = false) String cookieToken,
            @RequestBody(required = false) RefreshRequest body) {
        // Tolerant on the way out, unlike /refresh: a client whose cookie has already expired is
        // asking for a state it is already in, and answering 401 would leave it unable to tidy up.
        String presented = firstNonBlank(bodyToken(body), cookieToken);
        if (presented != null) {
            authService.logout(presented);
        }
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, refreshCookie.clear().toString())
                .build();
    }

    @GetMapping("/me")
    @Operation(summary = "The signed-in user and their business")
    public MeResponse me(@AuthenticationPrincipal AuthPrincipal principal) {
        return authService.me(principal);
    }

    @PostMapping("/forgot-password")
    @SecurityRequirements
    @Operation(summary = "Request a password reset link",
            description = """
                    Always 202, whether or not the address is registered (D6). Anything else is an
                    account-enumeration endpoint.""")
    public ResponseEntity<Void> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        authService.requestPasswordReset(request);
        return ResponseEntity.accepted().build();
    }

    /**
     * Consumes a reset token and sets the new password. Every refresh token the user holds is
     * revoked, and the cookie is cleared here too: the session that asked for the reset is exactly
     * the one that should not survive it.
     */
    @PostMapping("/reset-password")
    @SecurityRequirements
    @Operation(summary = "Set a new password with a reset token",
            description = """
                    Single use, one hour. On success every refresh token for that user is revoked,
                    because a reset exists to end sessions somebody else may have created.""")
    public ResponseEntity<Void> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        authService.resetPassword(request);
        return ResponseEntity.noContent()
                .header(HttpHeaders.SET_COOKIE, refreshCookie.clear().toString())
                .build();
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private ResponseEntity<AuthResponse> withRefreshCookie(HttpStatus status, AuthSession session) {
        ResponseCookie cookie =
                refreshCookie.set(session.refreshToken(), session.refreshTokenTtl());
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, cookie.toString())
                .body(session.tokens());
    }

    /**
     * The body wins over the cookie when both are present: a caller that troubled itself to send an
     * explicit token means that token, and this is the only way to present a <em>specific</em> one —
     * which is what testing reuse detection requires, since a browser has by then discarded it.
     */
    private static String presentedToken(String cookieToken, RefreshRequest body) {
        String presented = firstNonBlank(bodyToken(body), cookieToken);
        if (presented == null) {
            throw new ApiException(ErrorCode.UNAUTHENTICATED,
                    "No refresh token was presented. Sign in again.");
        }
        return presented;
    }

    private static String bodyToken(RefreshRequest body) {
        return body == null ? null : body.refreshToken();
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) {
            return first;
        }
        return second != null && !second.isBlank() ? second : null;
    }
}
