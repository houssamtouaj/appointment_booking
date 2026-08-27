package com.slotflow.notification;

import com.slotflow.common.web.FrontendLinks;
import java.time.Instant;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

/**
 * Every message this application would have sent, written to the log instead.
 *
 * <p>Selected by {@code app.mail.enabled=false}, and it is not a stub any more — it is the demo
 * profile's transport. The deployed demo must survive a mail relay that stops answering exactly as
 * it must survive an expired Stripe key: with this bean in place the whole feature is inert,
 * bookings still complete, invitations still work for whoever can read the log, and nothing in the
 * request path can fail because of SMTP. Turning mail on without a relay is what breaks, which is
 * the right way round.
 *
 * <p>It logs the tokens, which would be indefensible in production and is the point here: the
 * environments that select it are the ones where nobody can read the mail, so the alternative is a
 * flow nobody can complete. That is also why {@code app.mail.enabled} defaults to <em>on</em> —
 * this has to be asked for.
 *
 * <p>The links come from {@link com.slotflow.common.web.FrontendLinks} rather than being built
 * here, so the URL a developer copies out of the log is the same string
 * {@link MailNotificationService} would have put
 * in the mail. A second copy of that logic is how the two drift apart and the log stops being
 * evidence.
 */
@Service
@ConditionalOnProperty(name = "app.mail.enabled", havingValue = "false")
public class LoggingNotificationService implements NotificationService {

    private static final Logger log = LoggerFactory.getLogger(LoggingNotificationService.class);

    private final FrontendLinks links;

    public LoggingNotificationService(FrontendLinks links) {
        this.links = links;
    }

    @Override
    public void sendPasswordReset(Recipient recipient, String rawToken, Instant expiresAt) {
        log.info("""

                        --- password reset (mail disabled) -------------------------------------
                        to      : {} <{}>
                        expires : {}
                        link    : {}
                        ------------------------------------------------------------------------""",
                recipient.fullName(), recipient.email(), expiresAt, links.passwordReset(rawToken));
    }

    @Override
    public void sendStaffInvitation(Recipient recipient, String businessName,
            String rawToken, Instant expiresAt) {
        log.info("""

                        --- staff invitation (mail disabled) ------------------------------------
                        to      : {} <{}>
                        business: {}
                        expires : {}
                        link    : {}
                        ------------------------------------------------------------------------""",
                recipient.fullName(), recipient.email(), businessName, expiresAt,
                links.invitation(rawToken));
    }

    @Override
    public void sendBookingReceived(BookingNotification booking) {
        logBooking("booking received", booking, "pay     : " + booking.checkoutUrl()
                + "\nhold    : until " + booking.holdExpiresText());
    }

    @Override
    public void sendBookingConfirmed(BookingNotification booking) {
        logBooking("booking confirmed", booking, null);
    }

    @Override
    public void sendBookingCancelled(BookingNotification booking, CancelledBy cancelledBy) {
        logBooking("booking cancelled", booking, "by      : " + cancelledBy);
    }

    @Override
    public void sendBookingReminder(BookingNotification booking) {
        logBooking("booking reminder", booking, null);
    }

    private void logBooking(String what, BookingNotification booking, String extra) {
        log.info("""

                        --- {} (mail disabled) ---------------------------------
                        to      : {} <{}>
                        booking : {}
                        what    : {} with {} at {}
                        when    : {}{}
                        manage  : {}
                        ------------------------------------------------------------------------""",
                what, booking.guestName(), booking.recipient().email(), booking.bookingId(),
                booking.serviceName(), booking.staffName(), booking.businessName(),
                booking.whenText(), extra == null ? "" : "\n" + extra, booking.manageUrl());
    }
}
