package com.slotflow.security;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The reset ticket from D6: random, hashed, one hour, single use.
 *
 * <p>Three properties, each with a reason:
 *
 * <ul>
 *   <li><b>Single use through {@code used_at}, not deletion.</b> A consumed token can be
 *       distinguished from an unknown one, which is what makes "this link has already been used" a
 *       possible message rather than a mystery. The row is also a small audit trail.</li>
 *   <li><b>Requesting a new one invalidates the outstanding ones.</b> Otherwise every "I didn't get
 *       the mail, send it again" leaves another live hour-long key to the account.</li>
 *   <li><b>Expiry is measured against the injected clock</b>, so the one-hour rule is a test that
 *       moves time by 61 minutes rather than one nobody writes.</li>
 * </ul>
 */
@Service
public class PasswordResetService {

    private final PasswordResetTokenRepository resetTokens;
    private final Duration ttl;
    private final Clock clock;

    public PasswordResetService(PasswordResetTokenRepository resetTokens,
            AuthProperties properties, Clock clock) {
        this.resetTokens = resetTokens;
        this.ttl = properties.passwordResetTtl();
        this.clock = clock;
    }

    public record Issued(String rawValue, Instant expiresAt) {
    }

    @Transactional
    public Issued issueFor(UUID userId) {
        Instant now = clock.instant();
        List<PasswordResetToken> outstanding = resetTokens.findByUserIdAndUsedAtIsNull(userId);
        outstanding.forEach(token -> token.markUsed(now));
        resetTokens.saveAll(outstanding);

        String rawValue = SecretTokens.random();
        Instant expiresAt = now.plus(ttl);
        resetTokens.save(new PasswordResetToken(userId, SecretTokens.hash(rawValue), expiresAt));
        return new Issued(rawValue, expiresAt);
    }

    /**
     * Validates and burns a token.
     *
     * @return the user whose password may now be changed
     * @throws ApiException {@code 401} for a token that is unknown, expired or already used — one
     *                      answer for all three, because a caller holding a bad link can do nothing
     *                      differently with a more precise one, and telling them which it is
     *                      confirms that a token existed
     */
    @Transactional
    public UUID consume(String rawToken) {
        PasswordResetToken token = resetTokens.findByTokenHash(SecretTokens.hash(rawToken))
                .filter(candidate -> candidate.isValid(clock.instant()))
                .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHENTICATED,
                        "This password reset link is invalid or has expired. Request a new one."));
        token.markUsed(clock.instant());
        resetTokens.save(token);
        return token.getUserId();
    }
}
