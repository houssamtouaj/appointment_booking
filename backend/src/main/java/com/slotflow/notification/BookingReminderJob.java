package com.slotflow.notification;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.BookingStatus;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * The 24-hour reminder, sent once per booking and never twice.
 *
 * <h2>Idempotent by construction, not by hoping the job runs once</h2>
 * {@code reminder_sent_at} is a column, not a flag in memory, and the query that finds work
 * requires it to be null. So a second run in the same minute, a restart mid-batch, two instances
 * behind a load balancer and a manual invocation from a test all converge on the same outcome: one
 * email. {@link Booking#markReminderSent} refuses to stamp twice, which turns a double send from a
 * silent duplicate into an exception somebody can see.
 *
 * <h2>Stamp first, then send</h2>
 * The order is the whole design. Sending first and stamping afterwards means any failure between
 * the two — a crash, a rolled-back transaction, a lost connection — leaves an unstamped booking
 * that the next run will remind again. Stamping first makes this at-most-once: a send that fails
 * after the stamp is a reminder nobody receives, logged and not retried.
 *
 * <p>That is the right side to fail on. A customer who gets no reminder still has the confirmation,
 * the manage link and the appointment; a customer who gets three has a business that looks broken,
 * and there is no way to un-send the second one.
 *
 * <h2>The window is wide on the lower side, and that is not sloppiness</h2>
 * The nominal target is 24 hours ahead. The query asks for anything starting between one hour and
 * twenty-five hours from now, which does two things:
 *
 * <ul>
 *   <li><b>Overlap.</b> Consecutive runs cover overlapping ranges, so a run that is skipped,
 *       delayed or killed mid-batch does not create a permanent gap of bookings that were briefly
 *       in the window and are now past it. {@code reminder_sent_at} makes the overlap free.</li>
 *   <li><b>Catch-up, with a floor.</b> If the job was down for six hours, the bookings it missed
 *       are still found and still reminded — late, but a reminder eleven hours before an
 *       appointment is worth sending. The one-hour floor is where that stops: a reminder that
 *       arrives as the customer is parking outside is worse than none, so those are left alone
 *       and stay unstamped rather than being sent uselessly.</li>
 * </ul>
 *
 * <h2>The schedule</h2>
 * Every fifteen minutes, from {@code app.booking.reminder-cron}, and {@code -} disables it — the
 * same spelling and the same reason as {@code ExpiredBookingSweeper} and {@code ExpiredTokenSweeper}.
 * The integration suite disables it and calls {@link #run()} directly, because a job firing on its
 * own schedule while a test moves the clock forward by a day would stamp rows the test is about to
 * assert on.
 */
@Component
public class BookingReminderJob {

    private static final Logger log = LoggerFactory.getLogger(BookingReminderJob.class);

    /** How far ahead a reminder is aimed. The number in the templates' "tomorrow". */
    static final Duration LEAD = Duration.ofHours(24);

    /** Above the lead, so a run at 09:03 still catches a booking that was due at 09:00. */
    static final Duration OVERLAP = Duration.ofHours(1);

    /** Below which a reminder is no longer worth sending — see the class note. */
    static final Duration FLOOR = Duration.ofHours(1);

    private final BookingRepository bookings;
    private final BookingNotificationFactory notifications;
    private final NotificationService mail;
    private final TransactionTemplate transactions;
    private final Clock clock;

    public BookingReminderJob(BookingRepository bookings, BookingNotificationFactory notifications,
                              NotificationService mail,
                              PlatformTransactionManager transactionManager, Clock clock) {
        this.bookings = bookings;
        this.notifications = notifications;
        this.mail = mail;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    /**
     * @return how many reminders were sent, which is what the log line and the test want
     */
    @Scheduled(cron = "${app.booking.reminder-cron}")
    public int run() {
        Instant now = clock.instant();
        // Ids, not entities. Every row is re-read inside the transaction that stamps it, because
        // anything loaded out here is a snapshot of a moment that has already passed — and the
        // other writer on these rows is a customer cancelling.
        List<UUID> due = bookings.findDueReminders(now.plus(FLOOR), now.plus(LEAD).plus(OVERLAP))
                .stream()
                .map(Booking::getId)
                .toList();
        if (due.isEmpty()) {
            return 0;
        }

        int sent = 0;
        for (UUID id : due) {
            if (remind(id, now)) {
                sent++;
            }
        }
        if (sent > 0) {
            log.info("Sent {} booking reminder(s) as at {}", sent, now);
        }
        return sent;
    }

    /** @return whether this run is the one that reminded it */
    private boolean remind(UUID id, Instant now) {
        BookingNotification notification;
        try {
            notification = transactions.execute(status -> stamp(id, now));
        } catch (OptimisticLockingFailureException lostTheRace) {
            // Somebody wrote this row between the query and the flush — a cancellation, or the
            // payment webhook. Whatever it was, this run is no longer entitled to speak for it.
            log.debug("Booking {} was written by somebody else mid-run; leaving it alone", id);
            return false;
        }
        if (notification == null) {
            return false;
        }
        // Outside the transaction on purpose: the stamp is committed by the time anything is sent,
        // so a failure here costs one reminder rather than producing two.
        mail.sendBookingReminder(notification);
        return true;
    }

    /**
     * Stamps the row and builds the message from the same loaded entity.
     *
     * @return what to send, or null if this booking no longer qualifies
     */
    private BookingNotification stamp(UUID id, Instant now) {
        Booking booking = bookings.findById(id).orElse(null);
        // Re-checked rather than trusted. A booking cancelled between the query and here must not
        // be reminded, and the status filter in the query ran a few milliseconds ago.
        if (booking == null || booking.getStatus() != BookingStatus.CONFIRMED
                || booking.isReminderSent()) {
            return null;
        }
        booking.markReminderSent(now);
        bookings.saveAndFlush(booking);
        return notifications.compose(booking);
    }
}
