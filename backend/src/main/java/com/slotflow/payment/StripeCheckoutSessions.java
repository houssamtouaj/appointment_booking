package com.slotflow.payment;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.param.checkout.SessionCreateParams;
import jakarta.annotation.PostConstruct;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The few lines that talk to Stripe, and nothing else.
 *
 * <p>Everything worth testing is on the other side of {@link CheckoutSessions}; this class exists
 * to translate a {@link CheckoutSessions.Request} into {@code SessionCreateParams} and to turn a
 * {@link StripeException} into something the rest of the application understands. Together with the
 * webhook's signature check it is the whole of this codebase's contact with {@code com.stripe}.
 *
 * <h2>A missing key is a startup failure, not a failure at the first payment</h2>
 * {@code app.payments.enabled=true} with no {@code STRIPE_SECRET_KEY} is a deployment that boots,
 * serves every page, and fails on the first customer who tries to pay — at which point their slot
 * has been held for thirty minutes for nothing. {@link #refuseToStartWithoutAKey()} makes that a
 * startup failure instead. With payments disabled the key is not required and nothing here is ever
 * called: no booking is created {@code PENDING}, so no session is ever opened.
 *
 * <h2>Cards only</h2>
 * {@link #paramsFor} pins {@code payment_method_types} instead of inheriting whatever the Stripe
 * account has switched on. A deposit here holds a slot for thirty minutes, and a payment method
 * that settles in three days cannot hold anything — see the comment on the builder line, and
 * {@code StripeWebhookService.isPaid} for the half of that decision the webhook enforces.
 *
 * <h2>One client, built once and lazily</h2>
 * {@link StripeClient} is thread-safe and owns the connection pool, so a per-call instance would
 * throw away every keep-alive on a path that runs inside a booking transaction. It is built on
 * first use rather than in the constructor so that a context with payments disabled and no key
 * still starts — which is the configuration the deployed demo runs in.
 */
@Component
class StripeCheckoutSessions implements CheckoutSessions {

    private static final Logger log = LoggerFactory.getLogger(StripeCheckoutSessions.class);

    /**
     * One line item, one deposit. A constant because a booking is one appointment; a quantity that
     * varied would be a quiet way for the amount charged to differ from the amount this application
     * computed, stored and told the customer about.
     */
    private static final long ONE = 1L;

    private final StripeProperties properties;
    private final PaymentProperties payments;

    private volatile StripeClient client;

    StripeCheckoutSessions(StripeProperties properties, PaymentProperties payments) {
        this.properties = properties;
        this.payments = payments;
    }

    @PostConstruct
    void refuseToStartWithoutAKey() {
        if (payments.enabled() && !properties.hasSecretKey()) {
            throw new IllegalStateException(
                    "app.payments.enabled is true but STRIPE_SECRET_KEY is not set");
        }
    }

    @Override
    public Session open(Request request) {
        try {
            com.stripe.model.checkout.Session session = client().checkout().sessions().create(paramsFor(request));
            log.info("Opened Checkout session {} for booking {} ({} {})", session.getId(),
                    request.bookingId(), request.amountCents(), request.currency());
            return new Session(session.getId(), session.getUrl());
        } catch (StripeException refused) {
            // Logged in full here and nowhere else. PaymentGatewayException renders a fixed
            // sentence, because a Stripe message is written for somebody reading a dashboard and
            // can name an account, a mode or an API version.
            log.error("Stripe refused a Checkout session for booking {}", request.bookingId(),
                    refused);
            throw new PaymentGatewayException("checkout.sessions.create", refused);
        }
    }

    private static SessionCreateParams paramsFor(Request request) {
        return SessionCreateParams.builder()
                // A one-off payment, not a subscription and not a saved card. The deposit is the
                // whole of this integration's relationship with the customer's money.
                .setMode(SessionCreateParams.Mode.PAYMENT)
                // Cards only, and stated here rather than left to the account's dashboard. Every
                // delayed-notification method - SEPA debit, Bacs, Boleto, OXXO, Konbini, several
                // of the buy-now-pay-later options - completes its session with
                // payment_status: "unpaid" and settles days later, which a thirty-minute slot hold
                // cannot survive: the session expires long before the money arrives, so the
                // customer pays for an appointment the sweeper has already given away. Enabling one
                // in the dashboard would otherwise change this application's behaviour with no
                // change to this repository. StripeWebhookService.isPaid is the second half of the
                // same decision.
                .addPaymentMethodType(SessionCreateParams.PaymentMethodType.CARD)
                .setSuccessUrl(request.successUrl())
                .setCancelUrl(request.cancelUrl())
                // Pre-fills the field and, more usefully, is what the receipt goes to.
                .setCustomerEmail(request.customerEmail())
                // Seconds since the epoch, and kept in step with the slot hold — see DepositService
                // for why it is not exactly equal to it.
                .setExpiresAt(request.expiresAt().getEpochSecond())
                // How the webhook finds the row. Not a lookup by amount or by email, both of which
                // collide the moment two customers book the same service in the same minute.
                .putMetadata("bookingId", request.bookingId().toString())
                .putMetadata("businessId", request.businessId().toString())
                .addLineItem(SessionCreateParams.LineItem.builder()
                        .setQuantity(ONE)
                        .setPriceData(SessionCreateParams.LineItem.PriceData.builder()
                                // Stripe wants a lowercase ISO 4217 code; Currency gives it in
                                // uppercase. Locale.ROOT because the Turkish locale lowercases I
                                // to a dotless one, and "TRY" would become an unknown currency.
                                .setCurrency(request.currency().getCurrencyCode()
                                        .toLowerCase(Locale.ROOT))
                                .setUnitAmount(request.amountCents())
                                .setProductData(SessionCreateParams.LineItem.PriceData.ProductData
                                        .builder()
                                        .setName(request.description())
                                        .build())
                                .build())
                        .build())
                .build();
    }

    private StripeClient client() {
        StripeClient existing = client;
        if (existing != null) {
            return existing;
        }
        synchronized (this) {
            if (client == null) {
                client = new StripeClient(properties.secretKey());
            }
            return client;
        }
    }
}
