package com.slotflow.payment;

import java.nio.charset.StandardCharsets;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Signs a payload the way Stripe does, so the tests exercise the real verification.
 *
 * <p><b>Not a stub of the check.</b> Mocking {@code Webhook.constructEvent} would make the
 * signature test assert that a mock returns what it was told to, which is the one thing about this
 * endpoint that must not be taken on trust: the header is its entire authentication, and anyone who
 * can POST to a public path can claim a booking is paid. Producing a genuine HMAC here means the
 * tampering test really does fail verification, for the reason production would.
 *
 * <p>The scheme is {@code t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<payload>">}, keyed on the
 * webhook secret.
 *
 * <h2>The timestamp is wall-clock, and deliberately not the suite's movable one</h2>
 * Stripe's tolerance window is checked against {@code System.currentTimeMillis()} inside the
 * library, not against anything this application injects — which is correct, because a replayed
 * request is old in real time whatever the application thinks the date is. A signature stamped with
 * {@code TestTime.NOW} would be months out of tolerance and every webhook test would fail with an
 * error about timestamps.
 */
final class StripeSignatures {

    private static final String ALGORITHM = "HmacSHA256";

    private StripeSignatures() {}

    /** A header Stripe would have sent right now. */
    static String sign(String payload, String secret) {
        return sign(payload, secret, System.currentTimeMillis() / 1000L);
    }

    private static String sign(String payload, String secret, long timestamp) {
        return "t=" + timestamp + ",v1=" + hmac(timestamp + "." + payload, secret);
    }

    /**
     * A header that is well-formed and wrong.
     *
     * <p>Signed with a different secret rather than mangled by hand, so the failure is a real
     * verification failure and not a parse error — those take different paths through the library,
     * and only one of them is the attack being defended against.
     */
    static String forge(String payload) {
        return sign(payload, "whsec_somebody_elses_secret");
    }

    /** Stamped far enough in the past to fall outside Stripe's five-minute tolerance. */
    static String signStale(String payload, String secret) {
        // Same clock as sign() above, one spelling, for the reason in the class note: the tolerance
        // is checked against real time inside the library. TestHygieneTest names this file as the
        // suite's one allowed wall-clock reader, and it can only do that if there is one of them.
        return sign(payload, secret, System.currentTimeMillis() / 1000L - 3600L);
    }

    private static String hmac(String signedPayload, String secret) {
        try {
            Mac mac = Mac.getInstance(ALGORITHM);
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), ALGORITHM));
            return HexFormat.of().formatHex(
                    mac.doFinal(signedPayload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception impossible) {
            // HmacSHA256 is required of every JVM, and the key is never empty.
            throw new IllegalStateException("could not sign a test payload", impossible);
        }
    }
}
