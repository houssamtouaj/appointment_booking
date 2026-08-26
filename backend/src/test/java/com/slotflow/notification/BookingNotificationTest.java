package com.slotflow.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.ZoneId;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The one sentence in a booking email that a customer acts on: when.
 *
 * <p>Plan 12 puts this in bold — "a bare 15:00 in a booking confirmation is a support ticket
 * waiting to happen" — and the failure is not theoretical. Every instant in this schema is UTC, so
 * a formatter that forgets to convert renders 11:00 for a 13:00 appointment, and one that converts
 * but drops the zone renders a number that is right for the business and wrong for a customer
 * reading it in London.
 */
class BookingNotificationTest {

    @Test
    @DisplayName("the time is in the business timezone, with the zone spelled out")
    void timesCarryTheirZone() {
        BookingNotification booking = SampleBooking.paris().build();

        // 11:00 UTC, 13:00 in Paris in October. Both halves are asserted: the conversion, and the
        // abbreviation that makes the number mean something.
        assertThat(booking.whenText()).isEqualTo("Wed 14 Oct, 13:00 CEST");
        assertThat(booking.untilText()).isEqualTo("14:00 CEST");
    }

    @Test
    @DisplayName("a different business zone moves the same instant")
    void theZoneIsTheBusinessAndNotTheServer() {
        // The instant has not changed; only whose day it is being described in (D11). A business in
        // Tokyo reads the same booking as a different clock time and a different date, which is
        // precisely why the zone is on the business and not on the JVM.
        assertThat(SampleBooking.paris().inZone(ZoneId.of("Asia/Tokyo")).build().whenText())
                .isEqualTo("Wed 14 Oct, 20:00 JST");
        assertThat(SampleBooking.paris().inZone(ZoneId.of("UTC")).build().whenText())
                .isEqualTo("Wed 14 Oct, 11:00 UTC");
    }

    @Test
    @DisplayName("money is rendered from minor units in the business currency")
    void moneyKeepsItsCents() {
        BookingNotification booking = SampleBooking.paris().depositPaid(1350).build();

        assertThat(booking.priceText()).isEqualTo("€45.00");
        assertThat(booking.depositPaidText()).isEqualTo("€13.50");
        // What is still owed at the appointment. The templates say this out loud, because a
        // customer who has paid a deposit and expects to pay nothing else is an argument at a till.
        assertThat(booking.outstandingText()).isEqualTo("€31.50");
    }

    @Test
    @DisplayName("toString names the booking and nothing about the customer")
    void toStringIsSafeToLog() {
        BookingNotification booking = SampleBooking.paris().build();

        // This record is an argument to an @Async method, so the generated toString would end up in
        // AsyncConfig's uncaught-exception log — and from there in whatever aggregator the deploy
        // ships logs to — every time a relay is down.
        assertThat(booking.toString())
                .isEqualTo("BookingNotification[booking=" + SampleBooking.BOOKING_ID + "]")
                .doesNotContain("alex@example.test", "Alex Guest");
    }
}
