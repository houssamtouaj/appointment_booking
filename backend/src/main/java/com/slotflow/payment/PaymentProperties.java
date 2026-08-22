package com.slotflow.payment;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Whether this deployment takes deposits at all.
 *
 * <p>Plan 11 owns Stripe; this flag exists a wave earlier because the booking path has to read it
 * from day one. It is the difference between a booking created {@code CONFIRMED} and one created
 * {@code PENDING} with a 30-minute hold on the slot (D2/D3), and a {@code PENDING} booking with
 * nothing to confirm it is a slot that disappears for half an hour for no reason.
 *
 * <p>Off by default, deliberately. The deployed demo must survive an expired Stripe key: with
 * payments disabled the whole integration is inert, every booking is confirmed the moment it
 * exists, and nothing calls out to Stripe. Turning it on without keys is what would break, which
 * is the right way round.
 *
 * <p><b>Namespace.</b> Plan 11 spells this {@code slotflow.payments.enabled}. Everything
 * configurable in this application lives under {@code app.} — {@code app.security},
 * {@code app.rate-limit}, {@code app.stripe} — and a single property under a second root is a
 * property nobody finds when they go looking for the switches. The name is the plan's; the root is
 * the codebase's.
 *
 * @param enabled true once plan 11 can actually reach Stripe
 */
@ConfigurationProperties(prefix = "app.payments")
public record PaymentProperties(boolean enabled) {
}
