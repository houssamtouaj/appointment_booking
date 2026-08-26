package com.slotflow.payment;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * The two Stripe secrets, from the environment and nowhere else.
 *
 * <p>Neither has a default, and that is the point: a committed fallback key would look like
 * configuration and behave like a live credential in whatever account it belonged to. Both are
 * blank unless {@code STRIPE_SECRET_KEY} and {@code STRIPE_WEBHOOK_SECRET} are set, and
 * {@link StripeCheckoutSessions} refuses to start when payments are enabled and the secret key is
 * missing — the failure belongs at startup, not at the first customer who tries to pay.
 *
 * <p>Blank is a perfectly valid state. {@code app.payments.enabled=false} is the deployed demo's
 * configuration, and with it nothing here is ever read: no booking is created {@code PENDING}, so
 * no Checkout session is opened and the webhook has nothing to resolve.
 *
 * <p><b>Never logged, never in an error body.</b> {@link #toString()} is overridden for that
 * reason — a record's generated one prints its components, and this record is the sort of thing
 * that ends up in a startup banner or a {@code BeanCreationException} the day somebody misspells a
 * property name.
 *
 * @param secretKey     {@code sk_test_...}. Server-side only; the browser never sees it, because
 *                      the client's whole interaction with Stripe is following a URL we minted
 * @param webhookSecret {@code whsec_...}. Shared with nobody, and the only thing standing between
 *                      this API and anyone who can POST to a public path claiming a booking is paid
 */
@ConfigurationProperties(prefix = "app.stripe")
public record StripeProperties(String secretKey, String webhookSecret) {

    public StripeProperties {
        secretKey = blankToNull(secretKey);
        webhookSecret = blankToNull(webhookSecret);
    }

    public boolean hasSecretKey() {
        return secretKey != null;
    }

    public boolean hasWebhookSecret() {
        return webhookSecret != null;
    }

    /** Null rather than "", so "is it configured" is one null check instead of two conditions. */
    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    @Override
    public String toString() {
        return "StripeProperties[secretKey=%s, webhookSecret=%s]"
                .formatted(describe(secretKey), describe(webhookSecret));
    }

    /**
     * Whether it is set, and not one character of it.
     *
     * <p>Not even a prefix or a last-four. A Stripe key's prefix says which mode it is in, which is
     * the one thing worth knowing and is already visible in {@code app.payments.enabled}; anything
     * more is a fragment of a live credential in a log file that outlives the key.
     */
    private static String describe(String secret) {
        return secret == null ? "not set" : "set";
    }
}
