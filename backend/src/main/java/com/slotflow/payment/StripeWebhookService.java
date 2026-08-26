package com.slotflow.payment;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingEvent;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.BookingStatus;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.net.Webhook;
import java.time.Clock;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Applies a Stripe event, exactly once.
 *
 * <h2>Three independent reasons a replay cannot double-charge a booking</h2>
 * Stripe retries — a delivery that timed out, one that answered 500, one it is simply unsure
 * about — for up to three days. "Received once" is not a property of anything, so this is defended
 * three times over:
 *
 * <ol>
 *   <li><b>The event id is a primary key.</b> A second delivery of the same event is a
 *       duplicate-key violation from Postgres, not a check somebody remembered to write.</li>
 *   <li><b>The state changes are one-way.</b> Only {@code PENDING} confirms, only an active booking
 *       cancels. A replay that somehow got past the row above would still find nothing to do.</li>
 *   <li><b>One transaction.</b> The event row and the booking change commit together or not at all,
 *       so there is no state in which the event is recorded as applied and the booking did not
 *       move — which would make the next retry short-circuit and lose a real payment.</li>
 * </ol>
 *
 * <p>That third point is why a failure here is allowed to become a {@code 5xx}. Nothing was
 * applied, so Stripe retrying is precisely the correct outcome.
 *
 * <h2>The payload is read twice, on purpose</h2>
 * {@link Webhook#constructEvent} verifies the signature and gives back an {@link Event}, and the
 * two fields taken from it — the id and the type — are top-level and stable across every API
 * version. The <em>data object</em> is read with Jackson instead of through Stripe's deserialiser,
 * which refuses outright when the event's API version differs from the library's. That mismatch is
 * not hypothetical: it is what happens when the Stripe account is upgraded, or when the CLI is a
 * version ahead of the pinned dependency, and its failure mode would be every webhook 500ing at
 * once with a message about API versions. Three field reads out of a JSON tree do not care.
 *
 * <h2>The race with the sweeper</h2>
 * A customer can pay in the same second the sweeper decides they have not (D3). The booking is
 * {@code CANCELLED} by the time the webhook lands, and this does <b>not</b> silently confirm it:
 * the slot may already belong to somebody else, and a double-booked appointment is worse than a
 * payment that needs sorting out. It is logged, recorded as processed and answered {@code 200}. In
 * a real product that is a refund case; refunds are out of scope (D7), and the thirty-minute hold
 * plus Stripe's own session expiry make it rare. Said out loud here rather than pretended away.
 */
@Service
public class StripeWebhookService {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookService.class);

    private static final String CHECKOUT_COMPLETED = "checkout.session.completed";
    private static final String CHECKOUT_EXPIRED = "checkout.session.expired";

    private final StripeEventRepository events;
    private final BookingRepository bookings;
    private final StripeProperties properties;
    private final ApplicationEventPublisher publisher;
    private final ObjectMapper json;
    private final Clock clock;

    public StripeWebhookService(StripeEventRepository events, BookingRepository bookings,
                                StripeProperties properties, ApplicationEventPublisher publisher,
                                ObjectMapper json, Clock clock) {
        this.events = events;
        this.bookings = bookings;
        this.properties = properties;
        this.publisher = publisher;
        this.json = json;
        this.clock = clock;
    }

    @Transactional
    public void handle(String payload, String signature) {
        Event event = verify(payload, signature);
        if (alreadyApplied(event.getId())) {
            log.info("Stripe event {} has already been applied; ignoring the replay",
                    event.getId());
            return;
        }

        JsonNode session = dataObjectOf(payload);
        UUID bookingId = bookingIdOf(session);
        record(event, bookingId);

        switch (event.getType()) {
            case CHECKOUT_COMPLETED -> confirm(bookingId, session);
            case CHECKOUT_EXPIRED -> release(bookingId);
            // Recorded as seen and ignored. Stripe sends whatever the account is subscribed to, and
            // the subscription is configured outside this repository — so an unfamiliar type is a
            // routine event and not an error. Answering anything but 200 would have Stripe retry it
            // for three days.
            default -> log.debug("Ignoring Stripe event {} of type {}", event.getId(),
                    event.getType());
        }
    }

    // ---------------------------------------------------------------------------------
    //  authentication
    // ---------------------------------------------------------------------------------

    /**
     * The signature is the authentication, so this is the security boundary of a public endpoint
     * that moves money.
     *
     * <p>{@link Webhook#constructEvent} does two things worth naming: a constant-time HMAC
     * comparison, and a timestamp tolerance that makes a captured-and-replayed request stop working
     * after five minutes. Both are why this is not a hand-rolled {@code MessageDigest.isEqual}.
     *
     * <p>Every refusal is the same {@code 400} with the same sentence. Distinguishing "no header"
     * from "bad signature" from "too old" would tell somebody probing the endpoint exactly which
     * part of a forgery to fix next.
     */
    private Event verify(String payload, String signature) {
        if (!properties.hasWebhookSecret()) {
            // Not a 400. Nothing was wrong with the request; this deployment cannot authenticate
            // anything, which is a configuration failure and belongs in the log as one.
            throw new IllegalStateException(
                    "STRIPE_WEBHOOK_SECRET is not set, so no webhook can be verified");
        }
        if (signature == null || signature.isBlank()) {
            throw invalidSignature();
        }
        try {
            return Webhook.constructEvent(payload, signature, properties.webhookSecret());
        } catch (SignatureVerificationException forged) {
            // The whole message, once, in the log. Nothing of it in the response.
            log.warn("Rejected a Stripe webhook with an invalid signature: {}",
                    forged.getMessage());
            throw invalidSignature();
        }
    }

    private static ApiException invalidSignature() {
        return new ApiException(ErrorCode.WEBHOOK_SIGNATURE_INVALID,
                "This request could not be verified.");
    }

    // ---------------------------------------------------------------------------------
    //  idempotency
    // ---------------------------------------------------------------------------------

    private boolean alreadyApplied(String eventId) {
        return events.existsById(eventId);
    }

    /**
     * Writes the "seen" row, and flushes it.
     *
     * <p>{@code saveAndFlush}, not {@code save}, for the same reason the booking insert flushes: a
     * plain save leaves the statement in the persistence context until commit, which happens after
     * this method returns and outside every {@code catch}. Two deliveries racing in the same second
     * both pass {@link #alreadyApplied} and one of them has to lose here, visibly, rather than at
     * commit time as an unexplained 500.
     */
    private void record(Event event, UUID bookingId) {
        try {
            events.saveAndFlush(
                    new StripeEvent(event.getId(), event.getType(), bookingId, clock.instant()));
        } catch (DataIntegrityViolationException raced) {
            // The other delivery is applying this event right now, in its own transaction. Ours has
            // done nothing yet, so abandoning it leaves exactly one application of the event.
            throw new DuplicateEventException(event.getId(), raced);
        }
    }

    /** A replay that lost a race, rather than anything wrong. Handled as a 200 by the advice. */
    static class DuplicateEventException extends RuntimeException {
        DuplicateEventException(String eventId, Throwable cause) {
            super("Stripe event " + eventId + " is already being applied", cause);
        }
    }

    // ---------------------------------------------------------------------------------
    //  the two events that matter
    // ---------------------------------------------------------------------------------

    private void confirm(UUID bookingId, JsonNode session) {
        Booking booking = load(bookingId).orElse(null);
        if (booking == null || !sessionMatches(booking, session)) {
            return;
        }
        if (booking.getStatus() != BookingStatus.PENDING) {
            // The sweeper got there first, or this is a second completion for one session. Either
            // way the booking is not ours to move. See the class note on the refund case.
            log.warn("Stripe says booking {} is paid, but it is {} - leaving it alone",
                    bookingId, booking.getStatus());
            return;
        }

        booking.recordDepositPaid(paidCents(session, booking));
        booking.confirm();
        bookings.saveAndFlush(booking);
        publisher.publishEvent(new BookingEvent.Confirmed(booking.getId(), booking.getBusinessId(),
                booking.getDepositPaidCents()));
        log.info("Booking {} confirmed by Stripe; deposit of {} recorded", bookingId,
                booking.getDepositPaidCents());
    }

    /**
     * Belt and braces with the plan-10 sweeper, and worth having even so: the sweeper runs once a
     * minute against our clock, and this arrives the moment Stripe's own session expiry fires.
     * Whichever is first frees the slot.
     */
    private void release(UUID bookingId) {
        Booking booking = load(bookingId).orElse(null);
        if (booking == null) {
            return;
        }
        if (!booking.isActive()) {
            log.debug("Booking {} was already {} when its Checkout session expired", bookingId,
                    booking.getStatus());
            return;
        }
        if (booking.getStatus() != BookingStatus.PENDING) {
            // A confirmed booking whose session expired means the payment landed and the session
            // was never closed out. Cancelling here would cancel a paid appointment.
            log.warn("Checkout session for booking {} expired, but the booking is {} - "
                    + "not cancelling it", bookingId, booking.getStatus());
            return;
        }
        booking.cancel();
        bookings.saveAndFlush(booking);
        publisher.publishEvent(new BookingEvent.Cancelled(booking.getId(), booking.getBusinessId(),
                BookingEvent.Cancelled.Source.EXPIRY, clock.instant()));
        log.info("Booking {} cancelled: its Checkout session expired", bookingId);
    }

    // ---------------------------------------------------------------------------------
    //  reading the payload
    // ---------------------------------------------------------------------------------

    private JsonNode dataObjectOf(String payload) {
        try {
            return json.readTree(payload).path("data").path("object");
        } catch (Exception unreadable) {
            // The signature already passed, so this is genuinely malformed JSON from Stripe, which
            // means something is wrong that a retry will not fix — but a 400 to a verified sender
            // is misleading. Let it be a 500 and be loud about it.
            throw new IllegalStateException("a signed Stripe payload was not readable JSON",
                    unreadable);
        }
    }

    /**
     * The booking id from the session's metadata, which is where {@code DepositService} put it.
     *
     * <p>Metadata rather than a lookup by amount, by email or by time: all three collide the moment
     * two customers book the same service in the same minute, and a webhook that resolves to the
     * wrong booking confirms an appointment nobody paid for.
     */
    private static UUID bookingIdOf(JsonNode session) {
        String value = session.path("metadata").path("bookingId").asText(null);
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException notAUuid) {
            return null;
        }
    }

    private Optional<Booking> load(UUID bookingId) {
        if (bookingId == null) {
            log.warn("A Stripe event carried no usable bookingId in its metadata");
            return Optional.empty();
        }
        Optional<Booking> booking = bookings.findById(bookingId);
        if (booking.isEmpty()) {
            log.warn("A Stripe event named booking {}, which does not exist", bookingId);
        }
        return booking;
    }

    /**
     * That the event is about the session this booking was actually sent to.
     *
     * <p>The signature already proves the event came from Stripe, so this is not a forgery check —
     * it is a consistency check against the one thing that would otherwise go unnoticed: a booking
     * whose session id does not match the event that is confirming it means two sessions exist for
     * one row, and confirming from the wrong one records the wrong amount.
     */
    private static boolean sessionMatches(Booking booking, JsonNode session) {
        String eventSessionId = session.path("id").asText(null);
        if (eventSessionId == null || eventSessionId.equals(booking.getStripeSessionId())) {
            return true;
        }
        log.warn("Stripe event names session {} but booking {} holds {} - ignoring it",
                eventSessionId, booking.getId(), booking.getStripeSessionId());
        return false;
    }

    /**
     * What Stripe says was taken, clamped to the booking's price.
     *
     * <p>The amount was computed server-side from {@code Business.depositFor} and sent to Stripe, so
     * agreement is the expected case and a mismatch is worth a warning. It is clamped rather than
     * rejected because {@code recordDepositPaid} refuses a deposit above the price, and an
     * exception here would become a {@code 5xx} that Stripe retries every few hours for three
     * days — turning a one-cent anomaly into a permanent alarm and an unconfirmed paid booking.
     */
    private static long paidCents(JsonNode session, Booking booking) {
        long reported = session.path("amount_total").asLong(0L);
        long clamped = Math.max(0L, Math.min(reported, booking.getPriceCents()));
        if (clamped != reported) {
            log.warn("Stripe reported {} for booking {}, which costs {}; recording {}",
                    reported, booking.getId(), booking.getPriceCents(), clamped);
        }
        return clamped;
    }
}
