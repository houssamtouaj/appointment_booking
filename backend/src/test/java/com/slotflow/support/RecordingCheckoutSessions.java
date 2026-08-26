package com.slotflow.support;

import com.slotflow.payment.CheckoutSessions;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * A Checkout session that never leaves the JVM, and remembers what it was asked for.
 *
 * <p>The interesting half of plan 11 is what goes <em>into</em> a session: the amount, computed
 * server-side and never received; the metadata the webhook resolves through; the expiry that has to
 * outlast Stripe's own thirty-minute floor without outliving the slot hold by more than a moment.
 * All of that is assertable here. What is replaced is one HTTPS call to a third party, which no
 * build can make and which — mocked — would only prove that this codebase can drive a Stripe
 * builder.
 *
 * <p>The session id it mints is unique per call, because {@code booking_stripe_session_key} is a
 * unique constraint and a fake that returned a constant would make the second booking in any test
 * fail on an insert rather than on anything the test was about.
 */
public class RecordingCheckoutSessions implements CheckoutSessions {

    private final List<Request> opened = new CopyOnWriteArrayList<>();
    private final AtomicInteger sequence = new AtomicInteger();

    /** When set, every call throws it — for the "Stripe refused" path. */
    private volatile RuntimeException failure;

    @Override
    public Session open(Request request) {
        RuntimeException asked = failure;
        if (asked != null) {
            throw asked;
        }
        opened.add(request);
        String id = "cs_test_" + sequence.incrementAndGet() + "_" + request.bookingId();
        return new Session(id, "https://checkout.stripe.test/c/pay/" + id);
    }

    public List<Request> opened() {
        return List.copyOf(opened);
    }

    /** What Stripe was asked to charge for one booking. Fails loudly rather than returning null. */
    public Request openedFor(UUID bookingId) {
        return opened.stream()
                .filter(request -> request.bookingId().equals(bookingId))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no Checkout session was opened for "
                        + bookingId));
    }

    public boolean openedNothingFor(UUID bookingId) {
        return opened.stream().noneMatch(request -> request.bookingId().equals(bookingId));
    }

    public void failWith(RuntimeException failure) {
        this.failure = failure;
    }

    /** Called before every test, so one test's sessions cannot be read by the next. */
    public void clear() {
        opened.clear();
        failure = null;
    }
}
