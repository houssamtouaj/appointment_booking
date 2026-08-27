package com.slotflow.booking;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Cancels {@code PENDING} bookings whose deposit never arrived (D3).
 *
 * <p>Without this, every abandoned Stripe checkout holds its slot forever, because
 * {@code booking_no_overlap} covers {@code PENDING} as well as {@code CONFIRMED}. The symptom is the
 * worst kind: a slot that no availability response offers, no booking list shows, and no error
 * explains.
 *
 * <h2>The race with the webhook, and why each row gets its own transaction</h2>
 * A customer can pay in the same second this decides they have not. Both writers reach the same row,
 * so the sweeper has to lose that race quietly rather than clobber a booking the webhook has just
 * confirmed. Two things make that true:
 *
 * <ul>
 *   <li>{@link Booking#cancel()} is reached only through {@link Booking#hasExpired}, re-checked
 *       inside the transaction that will write — so a row confirmed between the query and the
 *       update is skipped rather than cancelled.</li>
 *   <li>{@code @Version} on {@code Booking} closes the remaining window. If the webhook commits
 *       after that re-check and before this flush, the version has moved and the flush throws
 *       {@link OptimisticLockingFailureException}, which is caught here and treated as a no-op —
 *       the correct outcome, since the booking is confirmed and paid for.</li>
 * </ul>
 *
 * <p>A {@link TransactionTemplate} per booking rather than a {@code @Transactional} method, and that
 * is not ceremony. One transaction around the whole batch would mean a single lost race rolls back
 * every other cancellation in the run; a {@code @Transactional} method called from the loop below
 * would not open one at all, because self-invocation never passes through the proxy — the classic
 * version of this bug, where the annotation is present, correct and inert.
 *
 * <h2>The schedule</h2>
 * Every minute, from {@code app.booking.expiry-sweep-cron}. Plan 10 specifies
 * {@code fixedDelay = 60s}; a cron is the same cadence and gains the one thing a fixed delay cannot
 * express — {@code -} to disable the job, which the integration suite sets. The suite moves the
 * clock forward by hours at a time, so a sweep firing on its own schedule would cancel rows a test
 * is about to assert on, and which test it caught would depend on the wall clock. {@code
 * ExpiredBookingSweepIT} calls {@link #sweep()} directly instead, which is the only honest way to
 * assert what it cancels. Same reasoning, same spelling as {@code ExpiredTokenSweeper}.
 */
@Component
public class ExpiredBookingSweeper {

    private static final Logger log = LoggerFactory.getLogger(ExpiredBookingSweeper.class);

    private final BookingRepository bookings;
    private final ApplicationEventPublisher events;
    private final TransactionTemplate transactions;
    private final Clock clock;

    public ExpiredBookingSweeper(BookingRepository bookings, ApplicationEventPublisher events,
            PlatformTransactionManager transactionManager, Clock clock) {
        this.bookings = bookings;
        this.events = events;
        this.transactions = new TransactionTemplate(transactionManager);
        this.clock = clock;
    }

    /**
     * @return how many holds were released, which is what the log line and the test want
     */
    @Scheduled(cron = "${app.booking.expiry-sweep-cron}")
    public int sweep() {
        Instant now = clock.instant();
        // Ids, not entities. The rows are re-read inside the transaction that writes them, because
        // anything loaded out here is already a snapshot of a moment that has passed.
        List<UUID> expired = bookings.findExpiredPending(now).stream()
                .map(Booking::getId)
                .toList();
        if (expired.isEmpty()) {
            return 0;
        }

        int cancelled = 0;
        for (UUID id : expired) {
            if (release(id, now)) {
                cancelled++;
            }
        }
        if (cancelled > 0) {
            log.info("Released {} expired booking hold(s) as at {}", cancelled, now);
        }
        return cancelled;
    }

    /** @return whether this run is the one that cancelled it */
    private boolean release(UUID id, Instant now) {
        try {
            return Boolean.TRUE.equals(transactions.execute(status -> {
                Booking booking = bookings.findById(id).orElse(null);
                // Re-checked rather than trusted: hasExpired is false the moment the webhook has
                // confirmed the booking, which is exactly the outcome this job must not undo.
                if (booking == null || !booking.hasExpired(now)) {
                    return false;
                }
                booking.cancel();
                bookings.saveAndFlush(booking);
                events.publishEvent(new BookingEvent.Cancelled(booking.getId(),
                        booking.getBusinessId(), BookingEvent.Cancelled.Source.EXPIRY, now));
                return true;
            }));
        } catch (OptimisticLockingFailureException lostTheRace) {
            // Somebody else wrote this row between the re-check and the flush, and on this row the
            // only other writer is the payment webhook. Losing to it is the right result.
            log.debug("Booking {} was written by somebody else mid-sweep; leaving it alone", id);
            return false;
        }
    }
}
