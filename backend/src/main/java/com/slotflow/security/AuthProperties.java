package com.slotflow.security;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Every lifetime and cost factor auth depends on, in configuration rather than in constants.
 *
 * <p>The signing secret is the one value with no default: {@code app.security.jwt.secret} comes
 * from {@code JWT_SECRET} and nowhere else, and {@link JwtService} refuses to start without at
 * least 32 bytes of it. A committed fallback would be worse than no auth at all, because it would
 * look like auth.
 *
 * <p>One property under this prefix is deliberately absent from the record:
 * {@code app.security.token-sweep-cron} is read as a placeholder by
 * {@link ExpiredTokenSweeper}'s {@code @Scheduled}, which is resolved when the bean definition is
 * built and cannot reach a record component. Binding it here as well would mean two spellings of
 * one setting, and editing the visible one would change nothing.
 *
 * @param jwt              access-token signing and lifetime
 * @param refreshCookie    the two cookie attributes that differ between localhost and production
 * @param passwordResetTtl D6: one hour, single use
 * @param invitationTtl    plan 06: seven days
 * @param bcryptStrength   10–12 in production; the suite drops it to keep 200 logins affordable
 */
@ConfigurationProperties(prefix = "app.security")
public record AuthProperties(
        Jwt jwt,
        RefreshCookie refreshCookie,
        Duration passwordResetTtl,
        Duration invitationTtl,
        int bcryptStrength) {

    public AuthProperties {
        jwt = jwt != null ? jwt : new Jwt(null, null, null);
        refreshCookie = refreshCookie != null ? refreshCookie : new RefreshCookie(false, null);
        passwordResetTtl = positiveOrDefault(passwordResetTtl, Duration.ofHours(1), "passwordResetTtl");
        invitationTtl = positiveOrDefault(invitationTtl, Duration.ofDays(7), "invitationTtl");
        bcryptStrength = bcryptStrength == 0 ? 12 : bcryptStrength;
        if (bcryptStrength < 4 || bcryptStrength > 31) {
            throw new IllegalArgumentException("bcryptStrength must be between 4 and 31");
        }
    }

    /**
     * @param secret         HS256 key, at least 32 bytes, environment only
     * @param accessTokenTtl short on purpose: a revoked user keeps access until it expires, and
     *                       15 minutes is the size of that window (documented, not accidental)
     * @param refreshTokenTtl how long a login survives without being used
     */
    public record Jwt(String secret, Duration accessTokenTtl, Duration refreshTokenTtl) {

        public Jwt {
            accessTokenTtl = positiveOrDefault(accessTokenTtl, Duration.ofMinutes(15), "accessTokenTtl");
            refreshTokenTtl = positiveOrDefault(refreshTokenTtl, Duration.ofDays(7), "refreshTokenTtl");
        }
    }

    /**
     * The name and the path are constants in {@link RefreshTokenCookie}, not properties: they are
     * baked into {@code @CookieValue} and into the SPA's expectations, so making them
     * configurable would only create a way for the two ends to disagree.
     *
     * @param secure   false on plain-HTTP localhost, true everywhere a browser talks TLS
     * @param sameSite {@code Lax} by default — see {@link RefreshTokenCookie} for why that is the
     *                 CSRF answer for this cookie
     */
    public record RefreshCookie(boolean secure, String sameSite) {

        public RefreshCookie {
            sameSite = sameSite == null || sameSite.isBlank() ? "Lax" : sameSite;
        }
    }

    private static Duration positiveOrDefault(Duration value, Duration fallback, String field) {
        if (value == null) {
            return fallback;
        }
        if (value.isZero() || value.isNegative()) {
            throw new IllegalArgumentException(field + " must be positive");
        }
        return value;
    }
}
