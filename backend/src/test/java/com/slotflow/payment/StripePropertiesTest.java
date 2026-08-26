package com.slotflow.payment;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * A Stripe key must not appear in a log line, and a record's generated {@code toString} is exactly
 * how it would.
 *
 * <p>This is not a hypothetical route. A configuration record ends up in a startup banner, in a
 * {@code BeanCreationException} the day somebody misspells a property name, and in whatever the
 * deploy ships logs to — and a log aggregator keeps it for months, long after the key has been
 * rotated for the wrong reason.
 */
class StripePropertiesTest {

    private static final String LOOKS_LIKE_A_KEY = "sk_test_51QabcdefgHIJKLmnop";

    @Test
    @DisplayName("toString says whether a secret is set and never what it is")
    void secretsAreNeverPrinted() {
        StripeProperties properties = new StripeProperties(LOOKS_LIKE_A_KEY, "whsec_abcdef123456");

        assertThat(properties.toString())
                .doesNotContain(LOOKS_LIKE_A_KEY, "whsec_abcdef123456")
                // Not even a prefix or a last-four. The prefix says which mode the key is in, which
                // is already visible in app.payments.enabled; anything more is a fragment of a live
                // credential that outlives the key.
                .doesNotContain("sk_", "whsec_")
                .isEqualTo("StripeProperties[secretKey=set, webhookSecret=set]");
    }

    @Test
    @DisplayName("blank is normalised to absent, so one null check answers is-it-configured")
    void blanksBecomeNulls() {
        // The application's own default: both properties resolve to an empty string when the
        // environment variables are unset, and empty is not a key.
        StripeProperties unset = new StripeProperties("", "   ");

        assertThat(unset.secretKey()).isNull();
        assertThat(unset.webhookSecret()).isNull();
        assertThat(unset.hasSecretKey()).isFalse();
        assertThat(unset.hasWebhookSecret()).isFalse();
        assertThat(unset.toString())
                .isEqualTo("StripeProperties[secretKey=not set, webhookSecret=not set]");
    }
}
