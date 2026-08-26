package com.slotflow.booking;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.BookingScenario;
import com.slotflow.support.TestTime;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The expiry sweeper (D3): a deposit that never arrived must not hold a slot forever.
 *
 * <h2>Why these bookings are inserted directly</h2>
 * With {@code app.payments.enabled=false} — which is this wave's whole configuration — no request
 * can produce a {@code PENDING} booking, because a business that needs no deposit is confirmed the
 * moment it exists (D2). That would leave the sweeper with no producer and therefore no test until
 * plan 11, which is exactly the shape of gap that ships broken. The fixture builds the row the
 * webhook flow will produce, and the sweeper is exercised against it now.
 *
 * <p>The job is called directly rather than waited for. {@code app.booking.expiry-sweep-cron} is
 * {@code -} for the whole suite, because a sweep firing on its own minute would cancel rows another
 * test is about to assert on, and which test it caught would depend on the wall clock. Combined with
 * the movable clock, that makes "thirty-one minutes later" an assignment rather than a wait.
 *
 * <p><b>Every assertion is on a row this test inserted, never on the sweeper's return count.</b>
 * The sweep is deliberately global — it has no tenant, because an abandoned hold is abandoned
 * whoever it belongs to — so its count includes whatever the previous test in this class left
 * behind, and with container reuse, whatever the previous <em>run</em> left behind. A test that
 * asserted "it cancelled exactly one" would pass alone and fail in a suite, which is the worst
 * possible way for a test to be wrong.
 */
class ExpiredBookingSweepIT extends BookingScenario {

    @Autowired
    private ExpiredBookingSweeper sweeper;

    @Test
    @DisplayName("a PENDING booking older than its hold is cancelled, and its slot comes back")
    void anAbandonedCheckoutReleasesItsSlot() throws Exception {
        Salon salon = solo(aSalon());
        Booking held = bookings.save(aBooking().forService(salon.service())
                .withStaff(salon.dana()).at(NINE_AM)
                .awaitingDepositUntil(TestTime.NOW.plus(Duration.ofMinutes(30)))
                .build());

        // While the hold is live, the slot is genuinely gone: PENDING is inside the exclusion
        // constraint's WHERE clause, which is the entire reason this job has to exist.
        sweeper.sweep();
        assertThat(statusOf(held)).as("nothing has expired yet").isEqualTo(BookingStatus.PENDING);
        book(salon, NINE_AM).andExpect(status().isConflict());

        clock.advanceBy(Duration.ofMinutes(31));
        assertThat(sweeper.sweep()).as("at least this one").isPositive();

        Booking swept = bookings.findById(held.getId()).orElseThrow();
        assertThat(swept.getStatus()).isEqualTo(BookingStatus.CANCELLED);
        assertThat(swept.getExpiresAt())
                .as("the hold is over, so there is nothing left to time out")
                .isNull();

        book(salon, NINE_AM).andExpect(status().isCreated());
    }

    @Test
    @DisplayName("running it twice changes nothing: the second pass finds no expired holds")
    void theSweepIsIdempotent() throws Exception {
        Salon salon = solo(aSalon());
        bookings.save(aBooking().forService(salon.service()).withStaff(salon.dana()).at(NINE_AM)
                .awaitingDepositUntil(TestTime.NOW.minus(Duration.ofMinutes(1)))
                .build());

        assertThat(sweeper.sweep()).isPositive();
        assertThat(sweeper.sweep())
                .as("a job that is safe to run twice is a job that is safe to run at all")
                .isZero();
    }

    @Test
    @DisplayName("it never touches a CONFIRMED booking, whatever its expiry column once said")
    void aConfirmedBookingIsLeftAlone() throws Exception {
        Salon salon = solo(aSalon());
        Booking held = bookings.save(aBooking().forService(salon.service())
                .withStaff(salon.dana()).at(NINE_AM)
                .awaitingDepositUntil(TestTime.NOW.minus(Duration.ofMinutes(1)))
                .build());

        // The race the plan calls out: the webhook confirms a booking a second before the sweeper
        // decides it never paid. Confirming clears the expiry, so the narrow predicate no longer
        // matches and the sweeper cannot undo a payment that actually arrived.
        held.confirm();
        bookings.save(held);

        sweeper.sweep();
        assertThat(statusOf(held)).isEqualTo(BookingStatus.CONFIRMED);
    }

    @Test
    @DisplayName("one expired hold in a batch does not stop the others being released")
    void theBatchIsPerRow() {
        Salon salon = aSalon();
        Instant nine = NINE_AM;
        Instant eleven = parisTime("2026-03-04T11:00");
        for (Instant start : List.of(nine, eleven)) {
            bookings.save(aBooking().forService(salon.service()).withStaff(salon.dana()).at(start)
                    .awaitingDepositUntil(TestTime.NOW.minus(Duration.ofMinutes(1)))
                    .build());
        }
        bookings.save(aBooking().forService(salon.service()).withStaff(salon.sam()).at(nine)
                .awaitingDepositUntil(TestTime.NOW.minus(Duration.ofMinutes(1)))
                .build());

        // Each row gets its own transaction, so a lost race on one is a no-op on that one rather
        // than a rollback of the whole run.
        assertThat(sweeper.sweep()).isGreaterThanOrEqualTo(3);
        assertThat(bookings.findActiveForStaffBetween(
                List.of(salon.dana().getId(), salon.sam().getId()),
                parisTime("2026-03-04T00:00"), parisTime("2026-03-05T00:00")))
                .isEmpty();
    }

    private BookingStatus statusOf(Booking booking) {
        return bookings.findById(booking.getId()).orElseThrow().getStatus();
    }
}
