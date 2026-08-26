package com.slotflow.notification;

import com.slotflow.common.web.FrontendLinks;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * The real transport: Thymeleaf, SMTP, and one {@code .ics}.
 *
 * <h2>{@code @Async} is on this class and not on its callers</h2>
 * Every method here is a worker-thread method, which is what makes "a dead SMTP server must never
 * turn a successful booking into a 500" true by construction rather than by everyone remembering to
 * catch. The callers — {@link NotificationDispatcher} and {@link BookingNotifier} — run after
 * commit on the request thread and do their reads there, so the data a template needs is resolved
 * while a transaction still exists and only the network call is handed off. The other way round
 * (async listener, synchronous send) moves lazy-loading and transaction-boundary bugs onto a thread
 * with no way to report them.
 *
 * <p>Exceptions therefore have nobody to throw to. {@link EmailSender} catches, logs against a
 * reference and retries once; {@code AsyncConfig}'s {@code AsyncUncaughtExceptionHandler} is the
 * backstop for anything that escapes even that.
 *
 * <h2>Subjects are built here, bodies in templates</h2>
 * A subject line is one string with no markup, and putting it in the template means either a second
 * fragment per template or a Thymeleaf model round-trip to extract it. Both are more moving parts
 * than the sentence deserves. What it must not do is duplicate the body's formatting decisions,
 * which is why the reminder subject asks {@link BookingNotification} for the same
 * {@code whenText()} the body renders — one format, one timezone, no chance of a subject saying
 * 15:00 while the body says 16:00.
 */
@Service
@ConditionalOnProperty(name = "app.mail.enabled", havingValue = "true", matchIfMissing = true)
public class MailNotificationService implements NotificationService {

    /** "in 1 hour" / "in 7 days" — the same numbers the TTLs are configured with, spelled out. */
    private static final DateTimeFormatter EXPIRY =
            DateTimeFormatter.ofPattern("EEE d MMM yyyy, HH:mm 'UTC'", Locale.ENGLISH)
                    .withZone(ZoneId.of("UTC"));

    private final EmailSender mail;
    private final FrontendLinks links;
    private final Clock clock;

    public MailNotificationService(EmailSender mail, FrontendLinks links, Clock clock) {
        this.mail = mail;
        this.links = links;
        this.clock = clock;
    }

    // ---------------------------------------------------------------------------------
    //  identity
    // ---------------------------------------------------------------------------------

    @Override
    @Async
    public void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt) {
        mail.send("password-reset", "Reset your SlotFlow password", recipient,
                model(recipient,
                        "link", links.passwordReset(rawToken),
                        "expiresAt", EXPIRY.format(expiresAt),
                        "validFor", humanise(Duration.between(clock.instant(), expiresAt))),
                recipient.email());
    }

    @Override
    @Async
    public void sendStaffInvitation(Recipient recipient, String businessName, String rawToken,
                                    Instant expiresAt) {
        mail.send("staff-invitation", "You have been invited to join " + businessName, recipient,
                model(recipient,
                        "businessName", businessName,
                        "link", links.invitation(rawToken),
                        "expiresAt", EXPIRY.format(expiresAt),
                        "validFor", humanise(Duration.between(clock.instant(), expiresAt))),
                recipient.email());
    }

    // ---------------------------------------------------------------------------------
    //  bookings (D10)
    // ---------------------------------------------------------------------------------

    @Override
    @Async
    public void sendBookingReceived(BookingNotification booking) {
        mail.send("booking-received",
                "We are holding your " + booking.serviceName() + " appointment",
                booking.recipient(), bookingModel(booking), reference(booking));
    }

    /**
     * The one with the attachment.
     *
     * <p>{@code text/calendar} with {@code method=PUBLISH} rather than {@code REQUEST}: this is an
     * appointment the customer already agreed to, not an invitation they are being asked to accept
     * or decline. A {@code REQUEST} makes some clients render RSVP buttons and then mail an
     * acceptance to a {@code From} address that answers nothing.
     */
    @Override
    @Async
    public void sendBookingConfirmed(BookingNotification booking) {
        mail.send("booking-confirmed",
                "Your " + booking.serviceName() + " appointment at " + booking.businessName()
                        + " is confirmed",
                booking.recipient(), bookingModel(booking), reference(booking),
                new EmailSender.Attachment("appointment.ics",
                        "text/calendar; charset=UTF-8; method=PUBLISH",
                        IcsCalendar.forBooking(booking, clock.instant())));
    }

    @Override
    @Async
    public void sendBookingCancelled(BookingNotification booking, CancelledBy cancelledBy) {
        Map<String, Object> model = bookingModel(booking);
        model.put("cancelledBy", cancelledBy.name());
        mail.send("booking-cancelled",
                "Your " + booking.serviceName() + " appointment at " + booking.businessName()
                        + " has been cancelled",
                booking.recipient(), model, reference(booking));
    }

    @Override
    @Async
    public void sendBookingReminder(BookingNotification booking) {
        mail.send("booking-reminder",
                "Reminder: " + booking.serviceName() + " on " + booking.whenText(),
                booking.recipient(), bookingModel(booking), reference(booking));
    }

    // ---------------------------------------------------------------------------------
    //  models
    // ---------------------------------------------------------------------------------

    /**
     * One variable, {@code booking}, and the templates call its methods.
     *
     * <p>Flattening it into twenty model entries would mean every template knowing which of them
     * exist, and a typo in one of those names renders as an empty string rather than failing — the
     * worst kind of template bug, because the mail still sends and still looks almost right.
     */
    private static Map<String, Object> bookingModel(BookingNotification booking) {
        Map<String, Object> model = new LinkedHashMap<>();
        model.put("booking", booking);
        return model;
    }

    private static Map<String, Object> model(Recipient recipient, Object... keysAndValues) {
        Map<String, Object> model = new LinkedHashMap<>();
        model.put("recipientName", recipient.fullName());
        for (int i = 0; i < keysAndValues.length; i += 2) {
            model.put((String) keysAndValues[i], keysAndValues[i + 1]);
        }
        return model;
    }

    /** What a failure is logged by. The booking id, because that is what the rest of the log uses. */
    private static String reference(BookingNotification booking) {
        return "booking " + booking.bookingId();
    }

    /**
     * "1 hour", "7 days". Coarse on purpose: the mail also carries the exact instant, and a
     * customer reading "6 days, 23 hours and 12 minutes" learns nothing the round number did not
     * already tell them.
     */
    private static String humanise(Duration remaining) {
        long hours = Math.max(1, remaining.toHours());
        if (hours < 48) {
            return hours + (hours == 1 ? " hour" : " hours");
        }
        long days = remaining.toDays();
        return days + (days == 1 ? " day" : " days");
    }
}
