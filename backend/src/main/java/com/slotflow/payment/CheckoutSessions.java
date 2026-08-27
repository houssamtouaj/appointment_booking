package com.slotflow.payment;

import java.time.Instant;
import java.util.Currency;
import java.util.UUID;

/**
 * Opening a hosted payment page, as one method with no Stripe types in its signature.
 *
 * <h2>Why the seam is here and not further in</h2>
 * Everything above this interface — the deposit arithmetic, the metadata that lets a webhook find
 * its booking, the expiry that has to agree with the slot hold — is this application's logic and is
 * worth testing. Everything below it is an HTTP call to a third party that cannot be made from a
 * build. Putting the boundary at "give me a payment page for this amount" means
 * {@link DepositService} is fully exercised by the integration suite, and the only untested code is
 * the twenty lines of {@link StripeCheckoutSessions} that translate a request into
 * {@code SessionCreateParams}.
 *
 * <p>The alternative — mocking {@code StripeClient} — tests that this codebase can build a Stripe
 * builder, which is a fact about Stripe's API rather than about anything here.
 */
public interface CheckoutSessions {

    /**
     * What to charge, and how the answer finds its way back.
     *
     * @param bookingId    travels as metadata, and is how the webhook resolves the row. Not a
     *                     lookup by amount or by email, both of which collide
     * @param businessId   metadata as well. Never read by this application — the booking already
     *                     knows its tenant — and there so that a human reading a payment in the
     *                     Stripe dashboard can tell whose it was
     * @param amountCents  computed server-side from {@code Business.depositFor}, in minor units.
     *                     <b>Never a number from a request body</b>, which is the most common real
     *                     vulnerability in booking systems built from tutorials
     * @param description  what the customer sees on the payment page — the service, not "deposit"
     * @param expiresAt    when the page stops working, kept in step with the slot hold (D3) so an
     *                     abandoned checkout cannot be completed after the slot was released
     * @param successUrl   where Stripe returns a customer who paid: the manage page, which reads
     *                     the booking rather than trusting the redirect. A payment is confirmed by
     *                     the webhook and by nothing a browser says
     */
    record Request(UUID bookingId, UUID businessId, String description, long amountCents,
            Currency currency, String customerEmail, Instant expiresAt,
            String successUrl, String cancelUrl) {
    }

    /**
     * @param id  {@code cs_test_...}, stored on the booking under a unique constraint so one
     *            session belongs to exactly one booking and replay cannot cross rows
     * @param url the hosted page. Stripe returns it once, at creation, and it cannot be rebuilt
     *            from the id — which is why the booking stores it
     */
    record Session(String id, String url) {
    }

    /**
     * @throws PaymentGatewayException if Stripe refused or could not be reached. The caller lets it
     *         roll the booking back: a {@code PENDING} row with no way to pay is a slot lost for
     *         thirty minutes and a customer with nothing to click
     */
    Session open(Request request);
}
