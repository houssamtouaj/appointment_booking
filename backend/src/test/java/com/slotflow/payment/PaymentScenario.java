package com.slotflow.payment;

import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.PublicBookingResponse;
import com.slotflow.business.Business;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.StaffService;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.support.BookingScenario;
import com.slotflow.support.RecordingCheckoutSessions;
import com.slotflow.support.fixtures.Fixtures;
import java.time.Instant;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.TestPropertySource;

/**
 * The salon from {@code BookingScenario}, with deposits switched on.
 *
 * <h2>This one really does fork the application context, and it has to</h2>
 * {@code app.payments.enabled} is read at bean-creation time and decides whether a booking is born
 * {@code CONFIRMED} or {@code PENDING} — the property under test. Every other integration test in
 * this suite shares one context on purpose; these subclasses share a second one between themselves,
 * which is the smallest number that can express "with payments on" and "with payments off".
 *
 * <h2>The Stripe key is present and fake</h2>
 * {@code StripeCheckoutSessions} refuses to start when payments are enabled and no key is set —
 * deliberately, because the alternative is a deployment that fails at the first customer. So a key
 * has to exist here. It is obviously not a real one and is never used: {@link RecordingCheckoutSessions}
 * is {@code @Primary}, so the bean that would dial out is constructed, validated and left alone.
 *
 * <p>The webhook secret is real in the only sense that matters — {@code StripeSignatures} signs
 * with the same string, so the signature verification under test is the genuine HMAC and not a
 * stubbed-out check.
 */
@TestPropertySource(properties = {
        "app.payments.enabled=true",
        "app.stripe.secret-key=sk_test_this_is_not_a_key",
        "app.stripe.webhook-secret=" + PaymentScenario.WEBHOOK_SECRET,
})
@ContextConfiguration(classes = PaymentScenario.FakeStripe.class)
abstract class PaymentScenario extends BookingScenario {

    /** Shared with {@code StripeSignatures}, which is what makes the verification path real. */
    static final String WEBHOOK_SECRET = "whsec_test_secret_for_the_suite_only";

    /** Thirty per cent of the fixture's 5000-cent service: a deposit of 1500. */
    protected static final int DEPOSIT_PERCENT = 30;

    @Autowired
    protected RecordingCheckoutSessions checkouts;

    @Autowired
    protected StaffServiceRepository assignments;

    @BeforeEach
    void emptyTheCheckoutRecorder() {
        checkouts.clear();
    }

    /**
     * A salon whose business takes a deposit, and with one bookable staff member.
     *
     * <p>{@code solo} for the same reason the concurrency tests use it: with two staff available an
     * any-staff booking is served by whichever has the lighter day, and a test asserting on Dana's
     * calendar would depend on which of them won.
     */
    protected Salon aSalonTakingDeposits() {
        return aSalonTakingDeposits(DEPOSIT_PERCENT);
    }

    protected Salon aSalonTakingDeposits(int percent) {
        Salon salon = solo(aSalon());
        Business business = salon.tenant().business();
        business.setDepositPolicy(true, percent);
        businesses.save(business);
        return salon;
    }

    /**
     * A second service on the same salon, priced so that the deposit does not divide evenly.
     *
     * <p>Lives here rather than in one test because two of them need it: the charge has to be the
     * rounded value and so does what ends up stored, and a rounding claim proved on two different
     * prices is not a claim about anything.
     */
    protected ServiceOffering aServicePricedAt(Salon salon, long priceCents) {
        ServiceOffering service = services.save(Fixtures.aService()
                .forBusiness(salon.tenant().business())
                .withName("Trim " + priceCents)
                .withDuration(60)
                .withPriceCents(priceCents)
                .build());
        assignments.save(new StaffService(salon.businessId(), salon.dana().getId(),
                service.getId()));
        return service;
    }

    /** Books that service at 11:00 Paris, clear of the 09:00 slot the other tests use. */
    protected PublicBookingResponse bookAt11(Salon salon, ServiceOffering service)
            throws Exception {
        Instant elevenAm = parisTime("2026-03-04T11:00");
        String body = mockMvc.perform(bookRequest(salon.slug(), service.getId(), elevenAm,
                        salon.dana().getId(), "alex@example.test"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
        return json.readValue(body, PublicBookingResponse.class);
    }

    @TestConfiguration
    static class FakeStripe {

        /**
         * {@code @Primary}, so {@code DepositService} gets this and the real
         * {@code StripeCheckoutSessions} is never called. It is still a bean: its startup check on
         * the secret key is part of what these tests exercise.
         */
        @Bean
        @Primary
        RecordingCheckoutSessions recordingCheckoutSessions() {
            return new RecordingCheckoutSessions();
        }
    }
}
