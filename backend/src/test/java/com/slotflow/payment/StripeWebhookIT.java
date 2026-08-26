package com.slotflow.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingStatus;
import com.slotflow.booking.PublicBookingResponse;
import com.slotflow.support.RecordingNotificationService.SentAboutBooking.Kind;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code POST /api/webhooks/stripe}: the one endpoint that turns money into a confirmed booking.
 *
 * <h2>The signatures here are real</h2>
 * {@link StripeSignatures} computes the same HMAC Stripe does, against the same secret the context
 * is configured with, so the verification under test is the library's own and the tampering case
 * genuinely fails it. Stubbing that check would leave the endpoint's entire authentication
 * unexercised — and this is a public path on which a forged request would confirm an unpaid
 * appointment.
 *
 * <h2>Replay is asserted, not assumed</h2>
 * Stripe retries a delivery for up to three days. Every test here that sends an event sends it in a
 * way a retry could, and the replay case sends the identical bytes twice.
 */
class StripeWebhookIT extends PaymentScenario {

    private static final String WEBHOOK_PATH = "/api/webhooks/stripe";

    @Test
    @DisplayName("a completed session confirms the booking and records what was paid")
    void aPaidSessionConfirmsTheBooking() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);

        deliver(completed("evt_paid_1", held.id(), sessionIdOf(held), 1_500L))
                .andExpect(status().isOk());

        Booking confirmed = bookings.findById(held.id()).orElseThrow();
        assertThat(confirmed.getStatus()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(confirmed.getDepositPaidCents()).isEqualTo(1_500L);
        // The hold is over, so there is nothing left to time out and the sweeper stops seeing it.
        assertThat(confirmed.getExpiresAt()).isNull();

        // D10, both halves and in order: held, then confirmed. Never two confirmations.
        assertThat(notifications.bookingMailFor(held.id()))
                .extracting(sent -> sent.kind())
                .containsExactly(Kind.RECEIVED, Kind.CONFIRMED);
    }

    @Test
    @DisplayName("the rounded deposit is what is stored, not the raw percentage")
    void theStoredDepositIsTheRoundedOne() throws Exception {
        // 33% of 1235 is 407.55, and DepositCheckoutIT proves 408 is what reaches Stripe. This is
        // the other half of the same claim: the value that comes back is the value that is kept,
        // so there is no point in the round trip at which a second division could disagree.
        Salon salon = aSalonTakingDeposits(33);
        PublicBookingResponse held = bookAt11(salon, aServicePricedAt(salon, 1_235L));

        deliver(completed("evt_rounded", held.id(), sessionIdOf(held), 408L))
                .andExpect(status().isOk());

        assertThat(bookings.findById(held.id()).orElseThrow().getDepositPaidCents())
                .isEqualTo(408L);
    }

    @Test
    @DisplayName("replaying the same event id changes nothing and still answers 200")
    void aReplayIsANoOp() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);
        String payload = completed("evt_replayed", held.id(), sessionIdOf(held), 1_500L);

        deliver(payload).andExpect(status().isOk());
        // The identical bytes, signed afresh - which is exactly what a Stripe retry is.
        deliver(payload).andExpect(status().isOk());

        assertThat(bookings.findById(held.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CONFIRMED);
        assertThat(notifications.bookingMailFor(held.id(), Kind.CONFIRMED))
                .as("a second confirmation email is what the event table exists to prevent")
                .hasSize(1);
    }

    @Test
    @DisplayName("a tampered signature is a 400 and the booking stays PENDING")
    void aForgedSignatureChangesNothing() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);
        String payload = completed("evt_forged", held.id(), sessionIdOf(held), 1_500L);

        mockMvc.perform(webhook(payload, StripeSignatures.forge(payload)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("WEBHOOK_SIGNATURE_INVALID"))
                // Nothing that would tell somebody probing the endpoint which part of a forgery to
                // fix next: not the header, not the reason, not a timestamp comparison.
                .andExpect(jsonPath("$.detail").value("This request could not be verified."));

        assertThat(bookings.findById(held.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.PENDING);
        assertThat(notifications.bookingMailFor(held.id(), Kind.CONFIRMED)).isEmpty();
    }

    @Test
    @DisplayName("a missing signature header is refused the same way")
    void anUnsignedRequestIsRefused() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);

        mockMvc.perform(post(WEBHOOK_PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(completed("evt_bare", held.id(), sessionIdOf(held), 1_500L)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("WEBHOOK_SIGNATURE_INVALID"));

        assertThat(bookings.findById(held.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.PENDING);
    }

    @Test
    @DisplayName("a stale signature is refused, so a captured request cannot be replayed later")
    void anExpiredTimestampIsRefused() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);
        String payload = completed("evt_stale", held.id(), sessionIdOf(held), 1_500L);

        // Correctly signed, an hour old. Stripe's tolerance is five minutes, which is what turns a
        // request captured off the wire into one that stops working.
        mockMvc.perform(webhook(payload,
                        StripeSignatures.signStale(payload, PaymentScenario.WEBHOOK_SECRET)))
                .andExpect(status().isBadRequest());

        assertThat(bookings.findById(held.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.PENDING);
    }

    @Test
    @DisplayName("an expired session cancels the booking and frees the slot")
    void anExpiredSessionReleasesTheSlot() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);

        deliver(expired("evt_expired", held.id(), sessionIdOf(held)))
                .andExpect(status().isOk());

        assertThat(bookings.findById(held.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CANCELLED);
        // The exclusion constraint stops matching a cancelled row, so the same start is bookable
        // again with no cleanup job in between.
        book(salon, NINE_AM).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a payment for a booking the sweeper already cancelled does not resurrect it")
    void aLatePaymentDoesNotConfirmACancelledBooking() throws Exception {
        Salon salon = aSalonTakingDeposits();
        PublicBookingResponse held = bookOk(salon, NINE_AM);
        deliver(expired("evt_expired_first", held.id(), sessionIdOf(held)))
                .andExpect(status().isOk());
        // Somebody else takes the slot in the meantime, which is the whole reason confirming a
        // cancelled booking would be worse than a payment that needs sorting out.
        book(salon, NINE_AM).andExpect(status().isCreated());

        deliver(completed("evt_paid_late", held.id(), sessionIdOf(held), 1_500L))
                .andExpect(status().isOk());

        assertThat(bookings.findById(held.id()).orElseThrow().getStatus())
                .isEqualTo(BookingStatus.CANCELLED);
        assertThat(notifications.bookingMailFor(held.id(), Kind.CONFIRMED)).isEmpty();
    }

    @Test
    @DisplayName("an event type nobody handles is accepted and ignored")
    void anUnknownTypeIsStillA200() throws Exception {
        String payload = """
                {"id": "evt_unknown", "object": "event", "type": "payment_intent.created",
                 "data": {"object": {"id": "pi_test_1"}}}
                """;

        // Anything but a 200 would have Stripe retry it for three days, and the account's event
        // subscription is configured outside this repository - so an unfamiliar type is routine.
        deliver(payload).andExpect(status().isOk());
    }

    // ---------------------------------------------------------------------------------
    //  payloads
    // ---------------------------------------------------------------------------------

    private static String completed(String eventId, UUID bookingId, String sessionId,
                                    long amountTotal) {
        return event(eventId, "checkout.session.completed", bookingId, sessionId,
                """
                , "amount_total": %d, "currency": "eur", "payment_status": "paid"\
                """.formatted(amountTotal));
    }

    private static String expired(String eventId, UUID bookingId, String sessionId) {
        return event(eventId, "checkout.session.expired", bookingId, sessionId,
                ", \"status\": \"expired\"");
    }

    /**
     * The shape Stripe actually sends, trimmed to the fields this application reads.
     *
     * <p>Hand-written rather than built with the Stripe model classes, for the same reason the
     * service reads the data object with Jackson: a payload built from the pinned library version
     * would agree with it by construction, and the failure being guarded against is the one where
     * the account's API version and the library's do not agree.
     */
    private static String event(String eventId, String type, UUID bookingId, String sessionId,
                                String extra) {
        return """
                {"id": "%s",
                 "object": "event",
                 "api_version": "2020-08-27",
                 "created": 1772000000,
                 "type": "%s",
                 "data": {"object": {"id": "%s", "object": "checkout.session",
                          "metadata": {"bookingId": "%s", "businessId": "%s"}%s}}}
                """.formatted(eventId, type, sessionId, bookingId, UUID.randomUUID(), extra);
    }

    // ---------------------------------------------------------------------------------
    //  requests
    // ---------------------------------------------------------------------------------

    private org.springframework.test.web.servlet.ResultActions deliver(String payload)
            throws Exception {
        return mockMvc.perform(
                webhook(payload, StripeSignatures.sign(payload, PaymentScenario.WEBHOOK_SECRET)));
    }

    private static MockHttpServletRequestBuilder webhook(String payload, String signature) {
        return post(WEBHOOK_PATH)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Stripe-Signature", signature)
                .content(payload);
    }

    private String sessionIdOf(PublicBookingResponse booking) {
        return bookings.findById(booking.id()).orElseThrow().getStripeSessionId();
    }
}
