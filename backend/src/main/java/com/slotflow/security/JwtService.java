package com.slotflow.security;

import com.slotflow.staff.Role;
import com.slotflow.staff.User;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.JwtParser;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;
import javax.crypto.SecretKey;
import org.springframework.stereotype.Component;

/**
 * Issues and verifies the access token, which is the only credential an admin request carries.
 *
 * <h2>The claim set</h2>
 * {@code sub} (user id), {@code bid} (business id), {@code role}, plus {@code iat}, {@code exp}
 * and {@code jti}. {@code bid} is the tenant boundary — plans 06 onward read it and never trust a
 * path parameter — and {@code jti} exists so a token can be named in a log line without the log
 * holding a usable credential.
 *
 * <h2>Fifteen minutes, and why nothing here revokes</h2>
 * There is no access-token blocklist. Statelessness is the point: a valid signature is a valid
 * request, with no database round trip. The cost is a window — a deactivated user, or one whose
 * role changed, keeps their old rights until the token expires. Fifteen minutes bounds it, the
 * refresh endpoint is where the change lands, and it is written down in the README rather than
 * discovered.
 *
 * <h2>Time comes from the injected {@link Clock}</h2>
 * Both halves: {@code exp} is stamped from it and the parser validates against it. That is what
 * makes "the token has expired" a test that moves the clock instead of one that waits.
 */
@Component
public class JwtService {

    /** The tenant claim. Short because it is in every request header; documented because it is load-bearing. */
    static final String BUSINESS_CLAIM = "bid";
    static final String ROLE_CLAIM = "role";

    /** HS256 needs a key at least as long as its output. Anything shorter is refused by jjwt too. */
    private static final int MINIMUM_SECRET_BYTES = 32;

    private final SecretKey signingKey;
    private final Duration accessTokenTtl;
    private final Clock clock;
    private final JwtParser parser;

    public JwtService(AuthProperties properties, Clock clock) {
        this.signingKey = readSigningKey(properties.jwt().secret());
        this.accessTokenTtl = properties.jwt().accessTokenTtl();
        this.clock = clock;
        this.parser = Jwts.parser()
                .verifyWith(signingKey)
                // jjwt's own Clock, backed by ours, so expiry is evaluated against test time.
                .clock(() -> Date.from(clock.instant()))
                .build();
    }

    public Duration accessTokenTtl() {
        return accessTokenTtl;
    }

    /**
     * Signs a token for a user. Takes the entity rather than three loose ids so a caller cannot
     * pair one user's id with another's business.
     */
    public String issue(User user) {
        Instant now = clock.instant();
        return Jwts.builder()
                .subject(user.getId().toString())
                .claim(BUSINESS_CLAIM, user.getBusinessId().toString())
                .claim(ROLE_CLAIM, user.getRole().name())
                .id(UUID.randomUUID().toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(accessTokenTtl)))
                .signWith(signingKey, Jwts.SIG.HS256)
                .compact();
    }

    /**
     * Verifies a token and returns who it speaks for.
     *
     * <p>Every failure — bad signature, expired, malformed, unparseable claim — comes back as an
     * empty {@code null} rather than an exception, because the filter's response to all of them is
     * identical: no authentication, and the entry point answers 401. Telling a caller *why* their
     * token is unacceptable is an oracle, not a courtesy.
     *
     * @return the principal, or {@code null} if the token is not currently valid
     */
    public AuthPrincipal parse(String token) {
        try {
            Claims claims = parser.parseSignedClaims(token).getPayload();
            return new AuthPrincipal(
                    UUID.fromString(claims.getSubject()),
                    UUID.fromString(claims.get(BUSINESS_CLAIM, String.class)),
                    Role.valueOf(claims.get(ROLE_CLAIM, String.class)));
        } catch (JwtException | IllegalArgumentException | NullPointerException e) {
            return null;
        }
    }

    /**
     * Fails the application context rather than the first login. An API that starts without a
     * signing key and then 500s on every authentication is strictly worse than one that refuses to
     * boot with a message naming the variable.
     */
    private static SecretKey readSigningKey(String secret) {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                    "app.security.jwt.secret is not set. Provide JWT_SECRET with at least "
                            + MINIMUM_SECRET_BYTES + " bytes: openssl rand -base64 48");
        }
        byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
        if (bytes.length < MINIMUM_SECRET_BYTES) {
            throw new IllegalStateException(
                    "app.security.jwt.secret is only %d bytes; HS256 needs at least %d"
                            .formatted(bytes.length, MINIMUM_SECRET_BYTES));
        }
        return Keys.hmacShaKeyFor(bytes);
    }
}
