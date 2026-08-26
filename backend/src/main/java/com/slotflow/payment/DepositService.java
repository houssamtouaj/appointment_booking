package com.slotflow.payment;

import com.slotflow.booking.Booking;
import com.slotflow.business.Business;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.common.web.FrontendLinks;
import java.time.Duration;
import java.time.Instant;
import org.springframework.stereotype.Service;

/**
 * Turns a booking that owes a deposit into a booking with somewhere to pay it.
 *
 * <h2>The amount is computed here and never received</h2>
 * {@code Business.depositFor(booking.priceCents)} and nothing else. The price on the booking was
 * itself snapshotted from the service at creation (D14), so the whole chain from "what this service
 * costs" to "what Stripe is told to charge" runs through rows this application wrote. There is no
 * point at which a number from a request body enters it — which is the single most common real
 * vulnerability in booking systems built from tutorials, and the reason this method takes entities
 * rather than a {@code long}.
 *
 * <p>The rounding is {@code depositFor}'s, half up, and the rounded value is what is charged
 * <em>and</em> what the email quotes <em>and</em> what the webhook stores. One number, computed
 * once, in one place — the alternative is a one-cent discrepancy that is maddening to trace back to
 * whichever of three call sites divided by a hundred differently.
 */
@Service
public class DepositService {

    /**
     * Stripe requires a Checkout session to expire between 30 minutes and 24 hours from now, and
     * the slot hold is exactly 30 minutes (D3). Sending the hold's own expiry would land on the
     * boundary and be rejected the moment the request takes a second, so the session gets a minute
     * of slack.
     *
     * <p>That makes the page outlive the hold by up to a minute, and it is harmless in both
     * directions: the sweeper cancels the booking at thirty minutes, and the webhook only ever
     * confirms a booking that is still {@code PENDING}, so a payment arriving in that last minute
     * is logged and left alone rather than confirming a slot somebody else may already have.
     */
    private static final Duration STRIPE_MINIMUM_SESSION_LIFETIME = Duration.ofMinutes(30);

    private static final Duration SESSION_EXPIRY_SLACK = Duration.ofMinutes(1);

    private final CheckoutSessions sessions;
    private final FrontendLinks links;

    public DepositService(CheckoutSessions sessions, FrontendLinks links) {
        this.sessions = sessions;
        this.links = links;
    }

    /**
     * Opens the session and attaches it to the booking.
     *
     * <p>Mutates the entity rather than returning a URL, so that the session id and the URL land on
     * the row in the same transaction that created it. A booking that exists without its session id
     * is a booking the webhook cannot resolve, and there is no later moment at which that could be
     * repaired.
     *
     * @throws PaymentGatewayException if Stripe refused. Deliberately not caught by the caller: a
     *         {@code PENDING} booking with nowhere to pay is a slot lost for thirty minutes and a
     *         customer with nothing to click, so rolling the whole thing back and saying so is the
     *         kinder outcome
     */
    public void openCheckout(Booking booking, Business business, ServiceOffering service,
                             Instant now) {
        long amountCents = business.depositFor(booking.getPriceCents());
        if (amountCents <= 0) {
            // Unreachable through PublicBookingService, which only creates a PENDING booking when
            // the business requires a deposit — and requiresDeposit() is already false at 0%. Kept
            // because the alternative is sending a customer to a payment page for nothing, and a
            // future second caller should hit an exception rather than discover that in production.
            throw new IllegalStateException(
                    "booking " + booking.getId() + " owes no deposit, so it needs no checkout");
        }

        CheckoutSessions.Session session = sessions.open(new CheckoutSessions.Request(
                booking.getId(),
                business.getId(),
                // What the customer reads on Stripe's page. The service, not the word "deposit":
                // a line item saying "Deposit" tells somebody scanning a card statement nothing
                // about which appointment it was for.
                service.getName() + " deposit at " + business.getName(),
                amountCents,
                business.getCurrency(),
                booking.getGuestEmail(),
                sessionExpiry(booking, now),
                // Both point at the manage page, which reads the booking rather than trusting the
                // redirect. A payment is confirmed by the webhook and by nothing a browser says —
                // the success URL is a place to land, not evidence.
                links.bookingCheckoutReturn(booking.getCancellationToken(), true),
                links.bookingCheckoutReturn(booking.getCancellationToken(), false)));

        booking.attachCheckoutSession(session.id(), session.url());
    }

    private static Instant sessionExpiry(Booking booking, Instant now) {
        Instant hold = booking.getExpiresAt();
        Instant floor = now.plus(STRIPE_MINIMUM_SESSION_LIFETIME).plus(SESSION_EXPIRY_SLACK);
        return hold != null && hold.isAfter(floor) ? hold : floor;
    }
}
