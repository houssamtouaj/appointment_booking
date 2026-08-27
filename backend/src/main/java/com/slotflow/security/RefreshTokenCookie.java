package com.slotflow.security;

import java.time.Duration;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

/**
 * The refresh-token transport, decided here in writing (plan 05 step 3) because four other
 * things depend on it: CORS, CSRF, the SPA's Axios interceptor, and what a leaked browser
 * profile is worth.
 *
 * <h2>The decision</h2>
 * <b>The refresh token travels in an httpOnly cookie, and the access token lives in the SPA's
 * memory only.</b> Concretely:
 *
 * <ul>
 *   <li>{@code HttpOnly} — no script can read it, so an XSS bug cannot exfiltrate a seven-day
 *       credential. This is the whole reason for the choice; a refresh token in a JSON body ends
 *       up in {@code localStorage} in every codebase that has ever tried it, however firmly the
 *       README says otherwise.</li>
 *   <li>{@code Path=/api/auth} — the cookie is attached to {@code /refresh} and {@code /logout}
 *       and to nothing else, so ordinary admin traffic never carries it.</li>
 *   <li>{@code SameSite=Lax} — this is the CSRF answer, and it is the default. A cross-site
 *       {@code POST} does not send a Lax cookie at all, so the two endpoints that read it cannot
 *       be driven from another origin; and no other endpoint accepts a cookie for anything,
 *       because authorisation everywhere else is the {@code Authorization} header. That is why
 *       {@code csrf()} stays disabled in {@link SecurityConfig} rather than being disabled by
 *       omission.
 *       <p><b>A cross-site deployment cannot keep it.</b> With the SPA on one registrable domain
 *       and the API on another — the demo puts them on Vercel and Render — every call from the
 *       SPA is cross-site, so a Lax cookie is never attached and {@code /refresh} 401s for a
 *       reason no log explains. Those deployments set {@code REFRESH_COOKIE_SAME_SITE=None}
 *       (with {@code Secure}, which {@link AuthProperties.RefreshCookie} enforces) and give up
 *       this half of the argument. What still holds there: the cookie is unreadable to script,
 *       it is attached to two endpoints only, neither returns anything an attacker's page can
 *       read because {@code CorsConfig} is a strict origin allowlist, and neither grants any
 *       authority beyond the victim's own session. What is lost: a page on another origin can
 *       cause a rotation or a logout it cannot observe. If that nuisance ever needs closing,
 *       close it by requiring a custom request header on the two endpoints — a header no
 *       cross-origin form can set without a preflight the allowlist denies — not by returning
 *       to Lax, which does not work at all in that topology.</li>
 *   <li>{@code Secure} — configuration, not a constant: false on plain-HTTP localhost, true in
 *       every deployed environment ({@code REFRESH_COOKIE_SECURE=true}).</li>
 *   <li>Consequences for the client: CORS must send {@code allowCredentials}, the origin list can
 *       never be a wildcard, and the SPA's Axios instance needs {@code withCredentials: true}.
 *       {@code CorsConfig} already does the first two.</li>
 * </ul>
 *
 * <h2>The escape hatch, and its limits</h2>
 * {@code /refresh} and {@code /logout} also accept the token in the request body. That is not a
 * second transport for browsers — it is how a non-browser client, Swagger UI or an integration
 * test presents a specific token, which is the only way to demonstrate reuse detection at all:
 * once the browser has rotated, the previous value is gone from it by design. The raw value is
 * visible to a human in the {@code Set-Cookie} response header, which is where the wave-3 exit
 * demo takes it from.
 */
@Component
public class RefreshTokenCookie {

    /**
     * Referenced from {@code @CookieValue}, so it has to be a compile-time constant — which is
     * also the argument against making the name configurable: two ends that can disagree.
     */
    public static final String NAME = "slotflow_refresh";

    /** Scoped, so the cookie is absent from every request that has no business seeing it. */
    public static final String PATH = "/api/auth";

    private final AuthProperties.RefreshCookie settings;

    public RefreshTokenCookie(AuthProperties properties) {
        this.settings = properties.refreshCookie();
    }

    /** Max-Age matches the token's own lifetime, so the browser forgets it exactly when it dies. */
    public ResponseCookie set(String rawToken, Duration ttl) {
        return base(rawToken).maxAge(ttl).build();
    }

    /**
     * Same name, same path, empty value, {@code Max-Age=0}. Name and path both have to match the
     * cookie being replaced or the browser keeps the original and logout silently does nothing on
     * the client side — the server-side revocation happens either way.
     */
    public ResponseCookie clear() {
        return base("").maxAge(Duration.ZERO).build();
    }

    private ResponseCookie.ResponseCookieBuilder base(String value) {
        return ResponseCookie.from(NAME, value)
                .httpOnly(true)
                .secure(settings.secure())
                .path(PATH)
                .sameSite(settings.sameSite());
    }
}
