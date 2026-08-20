package com.slotflow.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;

/**
 * The one place a bearer-style secret is minted, and the one place it is hashed.
 *
 * <p>Three token families use it — refresh tokens, password-reset tokens and staff invitations —
 * and all three obey the same two rules:
 *
 * <ol>
 *   <li><b>256 bits from {@link SecureRandom}.</b> Not a UUID: {@code UUID.randomUUID()} has 122
 *       bits and, more to the point, reads like an identifier, which invites someone to log it.</li>
 *   <li><b>Only the SHA-256 hash is stored.</b> A lookup therefore hashes the presented value and
 *       queries by that, which is why every repository in this codebase exposes
 *       {@code findByTokenHash} and none of them takes a raw token.</li>
 * </ol>
 *
 * <p>Plain SHA-256 rather than BCrypt, deliberately. These values are already 256 bits of uniform
 * randomness, so there is nothing to brute-force and no dictionary to defend against — and a
 * hash has to be computable in one pass to be usable as a unique index and a lookup key. The
 * opposite choice applies to passwords, which is why those go through BCrypt instead.
 */
public final class SecretTokens {

    /** 32 bytes; base64url without padding, so it is 43 URL-safe characters. */
    private static final int TOKEN_BYTES = 32;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();

    private SecretTokens() {
    }

    /** The value handed to the client — in a cookie or in an emailed link — and never stored. */
    public static String random() {
        byte[] bytes = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(bytes);
        return ENCODER.encodeToString(bytes);
    }

    /** Lower-case hex, 64 characters, which is exactly what the {@code varchar(64)} columns hold. */
    public static String hash(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            throw new IllegalArgumentException("token must not be blank");
        }
        return HexFormat.of().formatHex(sha256().digest(rawToken.getBytes(StandardCharsets.UTF_8)));
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            // Every JVM ships SHA-256; this cannot happen, and pretending it might would only
            // push a checked exception into every caller.
            throw new IllegalStateException("SHA-256 is unavailable", e);
        }
    }
}
