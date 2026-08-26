package com.slotflow.payment;

import static org.assertj.core.api.Assertions.assertThat;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingStatus;
import com.slotflow.booking.PublicBookingResponse;
import com.slotflow.business.Business;
import com.slotflow.support.BookingScenario;
import com.slotflow.support.RecordingNotificationService.SentAboutBooking.Kind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The switch that keeps the deployed demo alive when a test key expires.
 *
 * <p>{@code app.payments.enabled} is off for this suite's main context — the application's own
 * default — so this class deliberately adds no property of its own and shares that context. The
 * business it builds is configured to require a 50% deposit and gets none of the deposit path: the
 * flag wins over the tenant's own policy, which is the direction that matters, because the flag is
 * the operator's and the policy is the customer's.
 *
 * <p>"Nothing calls Stripe" is asserted through its consequences rather than through a spy, and
 * that is stronger than it sounds. A booking with no session id, no checkout URL and no hold is a
 * booking that provably never reached {@code DepositService}: every one of those three is set in
 * the same method, before the transaction commits.
 */
class PaymentsDisabledIT extends BookingScenario {

    @Test
    @DisplayName("a deposit-requiring business still books straight through with payments off")
    void theFlagWinsOverTheBusinessPolicy() throws Exception {
        Salon salon = solo(aSalon());
        Business business = salon.tenant().business();
        business.setDepositPolicy(true, 50);
        businesses.save(business);

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        assertThat(created.status()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(created.checkoutUrl()).isNull();
        // No hold either. A PENDING booking with nothing to confirm it is a slot that disappears
        // for half an hour for no reason - which is exactly what this flag exists to prevent.
        assertThat(created.expiresAt()).isNull();

        Booking stored = bookings.findById(created.id()).orElseThrow();
        assertThat(stored.getStripeSessionId()).isNull();
        assertThat(stored.getStripeCheckoutUrl()).isNull();
        assertThat(stored.getDepositPaidCents()).isZero();

        // And one email, the confirmation. The "we are holding your slot" message describes a
        // state this booking was never in (D10).
        assertThat(notifications.bookingMailFor(created.id()))
                .singleElement()
                .satisfies(sent -> assertThat(sent.kind()).isEqualTo(Kind.CONFIRMED));
    }
}
