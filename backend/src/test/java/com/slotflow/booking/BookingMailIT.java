package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.notification.NotificationService.CancelledBy;
import com.slotflow.support.RecordingNotificationService.SentAboutBooking;
import com.slotflow.support.RecordingNotificationService.SentAboutBooking.Kind;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * What lands in a customer's inbox, and — more importantly — what does not.
 *
 * <p>Three of plan 12's acceptance criteria are claims about <em>counts</em>: never two
 * confirmations for one booking (D10), no mail at all from a rolled-back insert, and a booking that
 * returns {@code 201} even when nothing can be sent. None of them is observable from a response
 * body, and all three are the kind of bug that ships green and is reported by a customer, so they
 * are asserted here against the recording notification service rather than against MailHog — see
 * {@code RecordingNotificationService} for why an HTTP poll of a mailbox is a race and not a test.
 */
class BookingMailIT extends BookingScenario {

    @Autowired
    private PublicBookingService publicBookings;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("a booking with no deposit sends one confirmation and nothing else (D10)")
    void noDepositMeansOneConfirmation() throws Exception {
        Salon salon = solo(aSalon());

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        // The payments flag is off, so this booking was born CONFIRMED. The "we are holding your
        // slot" mail describes a state it was never in, and sending both is the D10 failure.
        assertThat(notifications.bookingMailFor(created.id()))
                .singleElement()
                .satisfies(sent -> {
                    assertThat(sent.kind()).isEqualTo(Kind.CONFIRMED);
                    assertThat(sent.booking().recipient().email()).isEqualTo("alex@example.test");
                    assertThat(sent.booking().serviceName()).isEqualTo("Haircut");
                    assertThat(sent.booking().staffName())
                            .isEqualTo(salon.dana().getFullName());
                    // The business timezone, not the server's — the whole reason the factory reads
                    // the business row before composing anything.
                    assertThat(sent.booking().whenText()).isEqualTo("Wed 4 Mar, 09:00 CET");
                });
    }

    @Test
    @DisplayName("cancelling adds one message, and it says who cancelled")
    void cancellingIsAcknowledged() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk());

        assertThat(notifications.bookingMailFor(created.id()))
                .extracting(SentAboutBooking::kind)
                .containsExactly(Kind.CONFIRMED, Kind.CANCELLED);
        assertThat(notifications.bookingMailFor(created.id(), Kind.CANCELLED))
                .singleElement()
                // A customer who cancelled gets an acknowledgement; a business cancelling owes an
                // apology. One template, three openings, chosen from this value.
                .satisfies(sent -> assertThat(sent.cancelledBy()).isEqualTo(CancelledBy.GUEST));
    }

    @Test
    @DisplayName("a booking whose transaction rolls back mails nobody")
    void aRolledBackBookingMailsNobody() {
        Salon salon = solo(aSalon());
        TransactionTemplate outer = new TransactionTemplate(transactionManager);

        // create() joins this transaction rather than opening its own, so marking it rollback-only
        // is what any later failure in the same request would do. The service returned a booking
        // and the row never existed: that is exactly the state in which an eager send produces a
        // confirmation for an appointment nobody has, with nothing to explain it.
        outer.execute(status -> {
            PublicBookingResponse doomed = publicBookings.create(salon.slug(), requestFor(salon));
            status.setRollbackOnly();
            return doomed;
        });

        assertThat(notifications.bookingMail()).isEmpty();
    }

    @Test
    @DisplayName("a notification layer that is down still leaves the customer with a booking")
    void aFailedSendIsNotA500() throws Exception {
        Salon salon = solo(aSalon());
        // Stands in for an unreachable SMTP host, and is strictly harder to survive: the real
        // failure happens on a worker thread inside an @Async method, this one on the request
        // thread inside the after-commit listener. If the booking survives this, it survives that.
        notifications.failEverySendWith(new IllegalStateException("relay refused the connection"));

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        assertThat(created.status()).isEqualTo(BookingStatus.CONFIRMED);
        assertThat(bookings.findById(created.id())).isPresent();
        assertThat(notifications.bookingMail()).isEmpty();
    }

    private BookingRequest requestFor(Salon salon) {
        return new BookingRequest(salon.serviceId(), salon.dana().getId(), NINE_AM,
                "Alex Guest", "alex@example.test", null, null);
    }
}
