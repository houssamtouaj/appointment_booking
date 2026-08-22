package com.slotflow.support;

import com.slotflow.booking.BookingEvent;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Everything that reached the far side of the after-commit boundary, so a test can assert on what a
 * customer would eventually have received.
 *
 * <p>It listens on the same phase the application's own listener does, which is the whole point: an
 * ordinary {@code @EventListener} here would record events the moment they were published and would
 * therefore pass identically whether the boundary existed or not — a test that cannot fail is worse
 * than no test, because it is believed.
 *
 * <p>{@code CopyOnWriteArrayList} because {@code BookingConcurrencyIT} publishes from two threads at
 * once, and a test harness that throws a {@code ConcurrentModificationException} inside the one test
 * the whole project is about would be a miserable way to spend an afternoon.
 */
public class RecordingBookingEvents {

    private final List<BookingEvent> received = new CopyOnWriteArrayList<>();

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    void on(BookingEvent event) {
        received.add(event);
    }

    public List<BookingEvent> received() {
        return List.copyOf(received);
    }

    public <T extends BookingEvent> List<T> received(Class<T> type) {
        return received.stream().filter(type::isInstance).map(type::cast).toList();
    }

    public void clear() {
        received.clear();
    }
}
