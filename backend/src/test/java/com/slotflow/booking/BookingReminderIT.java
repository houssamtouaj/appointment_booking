package com.slotflow.booking;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.notification.BookingReminderJob;
import com.slotflow.support.BookingScenario;
import com.slotflow.support.RecordingNotificationService.SentAboutBooking.Kind;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The reminder job, driven directly rather than by its cron.
 *
 * <p>{@code IntegrationTest} disables the schedule, and that is not merely tidiness: the job stamps
 * {@code reminder_sent_at}, the stamp is deliberately irreversible, and half this suite books
 * appointments a day or two out — exactly the window it reminds. A run firing on its own minute
 * would consume a booking a test is about to assert on, and which test it caught would depend on
 * the time of day the build ran.
 *
 * <p><b>Every assertion is on a row this test created, never on the job's return count.</b> Like
 * the expiry sweeper, the job is deliberately global — a reminder is due whoever the booking
 * belongs to — so its count includes whatever the previous test left behind, and with container
 * reuse, whatever the previous <em>run</em> left behind. A test asserting "it sent exactly one"
 * would pass alone and fail in a suite.
 *
 * <p>Every case moves the clock instead of waiting. The application's {@code Clock} is the movable
 * one, so the job's own arithmetic — the window, the floor, the stamp — is evaluated against the
 * same instant the assertion is written from.
 */
class BookingReminderIT extends BookingScenario {

    /** A day before the appointment: squarely inside the one-hour-to-twenty-five-hour window. */
    private static final Instant A_DAY_BEFORE = NINE_AM.minus(Duration.ofHours(24));

    @Autowired
    private BookingReminderJob reminders;

    @Test
    @DisplayName("running it twice sends one reminder and stamps the row")
    void remindersAreSentOnce() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);
        assertThat(reminderSentAt(created.id())).isNull();

        clock.setTo(A_DAY_BEFORE);
        reminders.run();
        reminders.run();

        // reminder_sent_at is what makes the second run a no-op rather than a second email, and it
        // is a column rather than a flag in memory so a restart between the two runs changes
        // nothing either.
        assertThat(notifications.bookingMailFor(created.id(), Kind.REMINDER)).hasSize(1);
        assertThat(reminderSentAt(created.id())).isEqualTo(A_DAY_BEFORE);
    }

    @Test
    @DisplayName("one unsendable booking does not take the rest of the batch with it")
    void oneBadRowDoesNotStarveTheBatch() throws Exception {
        Salon salon = solo(aSalon());
        // Soonest first is the batch order, so the poisoned row is reached before the other one.
        PublicBookingResponse poisoned = bookOk(salon, NINE_AM);
        PublicBookingResponse healthy = bookOk(salon, NINE_AM.plus(Duration.ofHours(1)));
        notifications.failSendsAbout(poisoned.id(),
                new IllegalStateException("booking " + poisoned.id() + " has no staff row"));

        clock.setTo(A_DAY_BEFORE);
        reminders.run();

        // The job is global across tenants and the batch is ordered, so an exception escaping the
        // loop would not cost one reminder - it would cost every booking after it, on this run and
        // on every run after it, for every business. BookingNotificationFactory throws exactly this
        // for a booking whose business, service or staff row has gone.
        assertThat(notifications.bookingMailFor(healthy.id(), Kind.REMINDER)).hasSize(1);
        assertThat(notifications.bookingMailFor(poisoned.id(), Kind.REMINDER)).isEmpty();
        // Stamped all the same: the stamp goes in before the send and is deliberately irreversible,
        // so a reminder nobody could send is one nobody receives rather than one sent twice later.
        assertThat(reminderSentAt(poisoned.id())).isEqualTo(A_DAY_BEFORE);
    }

    @Test
    @DisplayName("a cancelled booking is never reminded")
    void cancelledBookingsAreLeftAlone() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk());

        clock.setTo(A_DAY_BEFORE);
        reminders.run();

        assertThat(notifications.bookingMailFor(created.id(), Kind.REMINDER)).isEmpty();
        assertThat(reminderSentAt(created.id())).isNull();
    }

    @Test
    @DisplayName("a booking starting within the hour is skipped, and stays unstamped")
    void theFloorIsRespected() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        // What a job that was down for a long stretch would find. A reminder arriving as the
        // customer is parking outside is worse than none, so this one is deliberately not sent —
        // and deliberately not stamped either, so the row still reads as never reminded.
        clock.setTo(NINE_AM.minus(Duration.ofMinutes(30)));
        reminders.run();

        assertThat(notifications.bookingMailFor(created.id(), Kind.REMINDER)).isEmpty();
        assertThat(reminderSentAt(created.id())).isNull();
    }

    @Test
    @DisplayName("too early is left for the next run; a run that is late still catches it")
    void theWindowHasBothEdges() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        // Two days out. Reminding now would waste the only message whose value is that it arrives
        // while the customer can still act on it.
        clock.setTo(NINE_AM.minus(Duration.ofHours(48)));
        reminders.run();
        assertThat(reminderSentAt(created.id())).isNull();

        // ...and the overlap on the lower edge means a run twenty minutes behind schedule still
        // finds it, rather than leaving a permanent gap of bookings that were briefly due.
        clock.setTo(A_DAY_BEFORE.plus(Duration.ofMinutes(20)));
        reminders.run();
        assertThat(notifications.bookingMailFor(created.id(), Kind.REMINDER)).hasSize(1);
    }

    private Instant reminderSentAt(UUID bookingId) {
        return bookings.findById(bookingId).orElseThrow().getReminderSentAt();
    }
}
