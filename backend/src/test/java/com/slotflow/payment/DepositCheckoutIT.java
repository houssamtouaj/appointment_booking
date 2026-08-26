package com.slotflow.payment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.BookingStatus;
import com.slotflow.booking.PublicBookingResponse;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.support.RecordingNotificationService.SentAboutBooking.Kind;
import com.slotflow.support.fixtures.Fixtures;
import java.time.Duration;
import java.time.Instant;
import java.util.Currency;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * What a deposit-taking business's {@code POST /bookings} does.
 *
 * <p>The assertions that matter are about the <em>amount</em>. It is computed from the business and
 * the booking's snapshotted price and can be influenced by nothing in the request — which is the
 * single most common real vulnerability in booking systems built from tutorials, and the reason
 * these tests read what was sent to Stripe rather than only what came back.
 */
class DepositCheckoutIT extends PaymentScenario {

    @Autowired
    private StaffServiceRepository assignments;

    @Test
    @DisplayName("a deposit-taking booking is held, not confirmed, and comes back with a pay link")
    void aDepositBookingIsHeld() throws Exception {
        Salon salon = aSalonTakingDeposits();

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        assertThat(created.status()).isEqualTo(BookingStatus.PENDING);
        assertThat(created.checkoutUrl()).startsWith("https://checkout.stripe.test/");
        // D3: the hold is what makes PENDING mean something, and what the sweeper enforces.
        assertThat(created.expiresAt()).isEqualTo(clock.instant().plus(Duration.ofMinutes(30)));

        // Stored, not just returned. The manage page and the "we are holding your slot" email are
        // the other two readers, and a customer whose browser crashed has only those.
        assertThat(bookings.findById(created.id()).orElseThrow().getStripeCheckoutUrl())
                .isEqualTo(created.checkoutUrl());
    }

    @Test
    @DisplayName("the amount is the business's percentage of the snapshotted price, server-side")
    void theAmountComesFromTheBusiness() throws Exception {
        Salon salon = aSalonTakingDeposits();

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        CheckoutSessions.Request charged = checkouts.openedFor(created.id());
        // 30% of the fixture's 5000-cent service.
        assertThat(charged.amountCents()).isEqualTo(1_500L);
        assertThat(charged.currency()).isEqualTo(Currency.getInstance("EUR"));
        assertThat(charged.customerEmail()).isEqualTo("alex@example.test");
        // How the webhook finds the row. Not a lookup by amount or by email, both of which collide.
        assertThat(charged.businessId()).isEqualTo(salon.businessId());
        // Stripe requires a session to live at least thirty minutes; the slot hold is exactly
        // thirty. The session therefore outlives the hold by a minute, which is harmless in both
        // directions - see DepositService.
        assertThat(charged.expiresAt())
                .isAfterOrEqualTo(clock.instant().plus(Duration.ofMinutes(30)));
    }

    @Test
    @DisplayName("the deposit is rounded half up, and the rounded value is what is charged")
    void roundingIsHalfUpAndItIsWhatIsCharged() throws Exception {
        // 33% of 1235 is 407.55. Half up is 408, and 408 is what has to reach Stripe: a deposit
        // computed one way for the customer and another way for the charge is a one-cent
        // discrepancy that is maddening to trace back to whichever call site divided differently.
        Salon salon = aSalonTakingDeposits(33);
        ServiceOffering odd = aServicePricedAt(salon, 1_235L);

        PublicBookingResponse created = bookOdd(salon, odd);

        assertThat(checkouts.openedFor(created.id()).amountCents()).isEqualTo(408L);
    }

    @Test
    @DisplayName("a held booking is told it is held, and nothing else (D10)")
    void aHeldBookingGetsTheReceivedMail() throws Exception {
        Salon salon = aSalonTakingDeposits();

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        // Received, never confirmed. The confirmation is the webhook's to send, and sending both
        // here is the D10 failure: two confirmations for one booking.
        assertThat(notifications.bookingMailFor(created.id()))
                .singleElement()
                .satisfies(sent -> {
                    assertThat(sent.kind()).isEqualTo(Kind.RECEIVED);
                    assertThat(sent.booking().checkoutUrl()).isEqualTo(created.checkoutUrl());
                    assertThat(sent.booking().depositDueCents()).isEqualTo(1_500L);
                });
    }

    @Test
    @DisplayName("a business that takes no deposit still books straight through")
    void noDepositMeansNoStripe() throws Exception {
        // Payments are on for this context, so the only thing deciding is the business's own
        // policy - which is the switch an owner actually turns.
        Salon salon = solo(aSalon());

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        assertThat(created.status()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(created.checkoutUrl()).isNull();
        assertThat(checkouts.openedNothingFor(created.id())).isTrue();
    }

    @Test
    @DisplayName("Stripe refusing rolls the whole booking back, slot and all")
    void aRefusedSessionLeavesNoBooking() throws Exception {
        Salon salon = aSalonTakingDeposits();
        checkouts.failWith(new PaymentGatewayException("checkout.sessions.create",
                new IllegalStateException("Stripe is down")));

        book(salon, NINE_AM).andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("PAYMENT_UNAVAILABLE"))
                // Nothing about the account, the mode or the API version - a Stripe message is
                // written for somebody reading a dashboard, not for an anonymous booking page.
                .andExpect(jsonPath("$.detail").value(
                        "Payments are temporarily unavailable. Please try again in a moment."));

        // And the slot is still free. A PENDING row with nowhere to pay would hold it for thirty
        // minutes and give the customer nothing to click.
        assertThat(bookings.findActiveForStaffBetween(
                java.util.List.of(salon.dana().getId()), NINE_AM, NINE_AM.plusSeconds(1)))
                .isEmpty();
        assertThat(notifications.bookingMail()).isEmpty();
    }

    // ---------------------------------------------------------------------------------
    //  fixtures
    // ---------------------------------------------------------------------------------

    /** A second service on the same salon, priced so that the deposit does not divide evenly. */
    private ServiceOffering aServicePricedAt(Salon salon, long priceCents) {
        ServiceOffering service = services.save(Fixtures.aService()
                .forBusiness(salon.tenant().business())
                .withName("Trim")
                .withDuration(60)
                .withPriceCents(priceCents)
                .build());
        assignments.save(new StaffService(salon.businessId(), salon.dana().getId(),
                service.getId()));
        return service;
    }

    private PublicBookingResponse bookOdd(Salon salon, ServiceOffering service) throws Exception {
        Instant elevenAm = parisTime("2026-03-04T11:00");
        String body = mockMvc.perform(bookRequest(salon.slug(), service.getId(), elevenAm,
                        salon.dana().getId(), "alex@example.test"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readValue(body, PublicBookingResponse.class);
    }
}
