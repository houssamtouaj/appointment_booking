package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The after-commit boundary, tested a wave before anything is riding on it.
 *
 * <p>Payments (plan 11) and notifications (plan 12) both hang off {@link BookingEvent}, and both
 * send something a customer receives. The failure this guards against is silent and permanent: a
 * send that happens inside the booking transaction still happens when that transaction rolls back,
 * so the customer gets a confirmation for an appointment nobody has and the business has no row to
 * explain it. Retrofitting {@code @TransactionalEventListener(AFTER_COMMIT)} after the first
 * subscriber exists is how that bug ships, so the wiring goes in now and this class is what makes it
 * real rather than decorative.
 *
 * <p>The second test is the one that matters. It calls the service inside an outer transaction it
 * then rolls back, which is not something a controller ever does — but it is exactly what a failure
 * later in the same request looks like from in here, and it is the only way to observe that the
 * event did not escape.
 */
class BookingEventIT extends BookingScenario {

    @Autowired
    private PublicBookingService publicBookings;

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Test
    @DisplayName("a committed booking reaches the subscribers, once, with its own id")
    void aCommittedBookingIsAnnounced() throws Exception {
        Salon salon = solo(aSalon());

        PublicBookingResponse created = bookOk(salon, NINE_AM);

        List<BookingEvent.Created> announced = bookingEvents.received(BookingEvent.Created.class);
        assertThat(announced).hasSize(1);
        assertThat(announced.getFirst().bookingId()).isEqualTo(created.id());
        assertThat(announced.getFirst().businessId()).isEqualTo(salon.businessId());
        assertThat(announced.getFirst().awaitingDeposit())
                .as("payments are off this wave, so nothing is ever created on hold (D2)")
                .isFalse();

        // Cancelling is announced too, and says who did it — plan 12 owes a customer who cancelled
        // an acknowledgement and a customer the business cancelled an apology.
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk());
        assertThat(bookingEvents.received(BookingEvent.Cancelled.class))
                .singleElement()
                .satisfies(cancelled -> {
                    assertThat(cancelled.bookingId()).isEqualTo(created.id());
                    assertThat(cancelled.source())
                            .isEqualTo(BookingEvent.Cancelled.Source.GUEST);
                });
    }

    @Test
    @DisplayName("a booking whose transaction rolls back notifies nobody and leaves no row")
    void aRolledBackBookingIsSilent() {
        Salon salon = solo(aSalon());
        TransactionTemplate outer = new TransactionTemplate(transactionManager);

        // create() joins this transaction rather than opening its own, so marking it rollback-only
        // is what any later failure in the same request would do.
        PublicBookingResponse doomed = outer.execute(status -> {
            PublicBookingResponse response = publicBookings.create(salon.slug(), requestFor(salon));
            status.setRollbackOnly();
            return response;
        });

        // The call itself succeeded and handed back a booking, which is exactly the trap: from
        // inside the service everything went right, and the row still never existed.
        assertThat(doomed).isNotNull();

        assertThat(bookingEvents.received())
                .as("no row committed, so nothing may have been sent about it")
                .isEmpty();
        assertThat(bookings.findActiveForStaffBetween(List.of(salon.dana().getId()),
                NINE_AM, NINE_AM.plusSeconds(1))).isEmpty();
    }

    private BookingRequest requestFor(Salon salon) {
        return new BookingRequest(salon.serviceId(), salon.dana().getId(), NINE_AM,
                "Alex Guest", "alex@example.test", null, null);
    }
}
