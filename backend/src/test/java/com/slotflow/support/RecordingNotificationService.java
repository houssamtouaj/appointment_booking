package com.slotflow.support;

import com.slotflow.notification.BookingNotification;
import com.slotflow.notification.NotificationService;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * The test double for {@link NotificationService}: it keeps what was sent instead of sending it.
 *
 * <p>It exists for two reasons that turned out to be the same reason. The raw token is the one
 * thing the API deliberately never returns, so a test that wants to accept an invitation has to
 * read it the way the invitee would — this is that inbox. And an email is the only externally
 * visible consequence of several booking rules (D10's "never two confirmations", the reminder's
 * idempotence, "a rolled-back booking mails nothing"), so those rules are only assertable against
 * something that counts messages.
 *
 * <p><b>Assert here, not against MailHog.</b> The real send is {@code @Async}, so an HTTP poll of
 * MailHog's API is a race dressed up as a test: it passes on a fast machine, fails in CI, and gets
 * a sleep added to it. MailHog is for the manual check that the templates look right.
 *
 * <p>Registered once, in {@link ApiIntegrationTest}, so every API test shares a single application
 * context. A per-class {@code @MockitoBean} would work too and would fork the context cache for
 * each test class, which is the mistake the harness was built to avoid.
 */
public class RecordingNotificationService implements NotificationService {

    /** One entry per address, latest wins — a resend supersedes the invitation it replaces. */
    public record Sent(Recipient recipient, String rawToken, Instant expiresAt, String businessName) {
    }

    /**
     * One booking message. Kept as a list rather than a map keyed by booking, because the count is
     * the assertion: "exactly one confirmation" is a claim about how many of these exist.
     *
     * @param cancelledBy null except on a cancellation
     */
    public record SentAboutBooking(Kind kind, BookingNotification booking, CancelledBy cancelledBy) {

        public enum Kind {
            RECEIVED, CONFIRMED, CANCELLED, REMINDER
        }

        public UUID bookingId() {
            return booking.bookingId();
        }
    }

    private final Map<String, Sent> invitations = new ConcurrentHashMap<>();
    private final Map<String, Sent> passwordResets = new ConcurrentHashMap<>();

    /**
     * {@code CopyOnWriteArrayList} for the same reason {@link RecordingBookingEvents} uses one:
     * {@code BookingConcurrencyIT} drives two threads through the booking path at once.
     */
    private final List<SentAboutBooking> bookingMail = new CopyOnWriteArrayList<>();

    /**
     * When set, every send throws it.
     *
     * <p>For the one gate no amount of asserting on delivered mail can cover: a notification layer
     * that is down must not turn a committed booking into a 500. The real failure is an unreachable
     * SMTP host inside an {@code @Async} method, which a test cannot arrange without a mail server
     * to kill; this puts the same exception in the same place, on the caller's thread, which is
     * strictly harder to survive than the asynchronous version.
     */
    private volatile RuntimeException failure;

    /**
     * When set, sends about this one booking throw and every other send works.
     *
     * <p>{@link #failure} cannot express the property {@code BookingReminderIT} needs: that one
     * unsendable booking does not take the rest of the batch with it. A job looping over rows has to
     * be asserted against a batch in which exactly one row is poisoned.
     */
    private final Map<UUID, RuntimeException> failuresByBooking = new ConcurrentHashMap<>();

    // ---------------------------------------------------------------------------------
    //  the interface
    // ---------------------------------------------------------------------------------

    @Override
    public void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt) {
        failIfAsked();
        passwordResets.put(key(recipient), new Sent(recipient, rawToken, expiresAt, null));
    }

    @Override
    public void sendStaffInvitation(Recipient recipient, String businessName,
                                    String rawToken, Instant expiresAt) {
        failIfAsked();
        invitations.put(key(recipient), new Sent(recipient, rawToken, expiresAt, businessName));
    }

    @Override
    public void sendBookingReceived(BookingNotification booking) {
        record(SentAboutBooking.Kind.RECEIVED, booking, null);
    }

    @Override
    public void sendBookingConfirmed(BookingNotification booking) {
        record(SentAboutBooking.Kind.CONFIRMED, booking, null);
    }

    @Override
    public void sendBookingCancelled(BookingNotification booking, CancelledBy cancelledBy) {
        record(SentAboutBooking.Kind.CANCELLED, booking, cancelledBy);
    }

    @Override
    public void sendBookingReminder(BookingNotification booking) {
        record(SentAboutBooking.Kind.REMINDER, booking, null);
    }

    // ---------------------------------------------------------------------------------
    //  what a test asks it
    // ---------------------------------------------------------------------------------

    public Sent invitationTo(String email) {
        Sent sent = invitations.get(email.toLowerCase());
        if (sent == null) {
            throw new AssertionError("no invitation was sent to " + email);
        }
        return sent;
    }

    public Sent passwordResetTo(String email) {
        Sent sent = passwordResets.get(email.toLowerCase());
        if (sent == null) {
            throw new AssertionError("no password reset was sent to " + email);
        }
        return sent;
    }

    public boolean sentNothingTo(String email) {
        String key = email.toLowerCase();
        return !invitations.containsKey(key) && !passwordResets.containsKey(key);
    }

    /** Every booking message, in the order they were sent. */
    public List<SentAboutBooking> bookingMail() {
        return List.copyOf(bookingMail);
    }

    /** Every booking message about one booking, which is what "exactly one of these" is asked of. */
    public List<SentAboutBooking> bookingMailFor(UUID bookingId) {
        return bookingMail.stream().filter(sent -> sent.bookingId().equals(bookingId)).toList();
    }

    public List<SentAboutBooking> bookingMailFor(UUID bookingId, SentAboutBooking.Kind kind) {
        return bookingMailFor(bookingId).stream().filter(sent -> sent.kind() == kind).toList();
    }

    /** Makes the next and every subsequent send throw. See {@link #failure}. */
    public void failEverySendWith(RuntimeException failure) {
        this.failure = failure;
    }

    /** Makes sends about one booking throw, and leaves every other booking alone. */
    public void failSendsAbout(UUID bookingId, RuntimeException failure) {
        failuresByBooking.put(bookingId, failure);
    }

    /** Called before every test, so one test's mail cannot be read by the next. */
    public void clear() {
        invitations.clear();
        passwordResets.clear();
        bookingMail.clear();
        failure = null;
        failuresByBooking.clear();
    }

    private void record(SentAboutBooking.Kind kind, BookingNotification booking,
                        CancelledBy cancelledBy) {
        failIfAsked();
        RuntimeException poisoned = failuresByBooking.get(booking.bookingId());
        if (poisoned != null) {
            throw poisoned;
        }
        bookingMail.add(new SentAboutBooking(kind, booking, cancelledBy));
    }

    private void failIfAsked() {
        RuntimeException asked = failure;
        if (asked != null) {
            throw asked;
        }
    }

    private static String key(Recipient recipient) {
        return recipient.email().toLowerCase();
    }
}
