package com.slotflow.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import com.slotflow.notification.NotificationService.CancelledBy;
import com.slotflow.support.IntegrationTest;
import jakarta.mail.Multipart;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * The six templates, rendered by the real engine and captured on their way to SMTP.
 *
 * <h2>Why a spy on the transport and not MailHog</h2>
 * Asserting against MailHog's HTTP API means polling a second process for the result of an
 * {@code @Async} send: it passes on a fast laptop, fails in CI, and acquires a {@code sleep}. Plan
 * 12 says so explicitly. Spying on {@link JavaMailSender} keeps the whole real path — Thymeleaf,
 * both template modes, {@code MimeMessageHelper}, the multipart assembly, the {@code .ics} — and
 * removes only the socket. MailHog stays what it is good for: looking at the mail with your eyes.
 *
 * <p>{@code timeout()} on the verification rather than a sleep, because the send genuinely is on
 * another thread and that is the property being exercised. It waits for the condition instead of
 * for the clock, so a generous ceiling costs nothing except on a test that was going to fail —
 * see {@link #SEND_TIMEOUT_MS} for why the ceiling has to be generous.
 *
 * <h2>What is deliberately not asserted</h2>
 * The markup. A test that pins the HTML is a test that fails every time somebody changes a padding
 * value, so it gets ignored and then deleted. What is pinned is the content a customer needs and a
 * bug would silently remove: the time with its zone, the manage link, the deposit wording (D7), and
 * the calendar attachment.
 */
class EmailRenderingIT extends IntegrationTest {

    /**
     * By the interface, not by {@link MailNotificationService}: {@code @Async} wraps the bean in a
     * JDK interface proxy, so asking for the concrete class fails to start the context. That is
     * also the right way round for a test — it exercises what every caller in the application
     * actually holds, and it means this class extends {@code IntegrationTest} rather than
     * {@code ApiIntegrationTest} on purpose, because the latter registers a recording double as the
     * primary implementation and there would be nothing real left to send.
     */
    @Autowired
    private NotificationService notifications;

    @MockitoSpyBean
    private JavaMailSender transport;

    /**
     * How long a verification waits for the {@code @Async} send, and it is deliberately far more
     * than a send takes.
     *
     * <p>The steady-state figure is under 200 ms. The <em>first</em> send in the JVM is not: it pays
     * once for the Thymeleaf engine, parsing six templates, and building the first mail session, and
     * that was measured at almost exactly five seconds. So a five-second ceiling put whichever test
     * happened to run first in this class on a knife edge, and losing that race did not fail one
     * test — it failed two. The late send arrived after Mockito had reset the spy for the next test,
     * which then read the previous test's message and asserted the wrong subject against it.
     *
     * <p>Warming the path in a {@code @BeforeEach} would be the other fix and a worse one: the
     * warm-up send is an invocation on the spy, so every verification here would have to reason
     * about which message it was looking at. Raising a ceiling that is not the assertion costs
     * nothing while the suite is green, and this number is not a deadline anything is measured
     * against.
     */
    private static final int SEND_TIMEOUT_MS = 20_000;

    @BeforeEach
    void doNotActuallySend() {
        doNothing().when(transport).send(any(MimeMessage.class));
    }

    @Test
    @DisplayName("a confirmation carries both formats, the zone, the manage link and an .ics")
    void confirmationIsComplete() throws Exception {
        notifications.sendBookingConfirmed(SampleBooking.paris().depositPaid(1350).build());

        MimeMessage message = captured();
        assertThat(message.getSubject())
                .isEqualTo("Your Haircut appointment at Dana Salon is confirmed");
        assertThat(message.getAllRecipients()).hasSize(1);
        assertThat(message.getAllRecipients()[0].toString()).isEqualTo("alex@example.test");

        List<String> bodies = textPartsOf(message);
        assertThat(bodies)
                .as("multipart/alternative: an HTML-only transactional mail scores worse with "
                        + "spam filters and is unreadable to a screen reader")
                .hasSize(2);
        assertThat(bodies).allSatisfy(body -> assertThat(body)
                .contains("Wed 14 Oct, 13:00 CEST")
                .contains("https://app.slotflow.test/booking/" + SampleBooking.CANCELLATION_TOKEN)
                // D7, in the confirmation and not only in the terms: a customer must not discover
                // that the deposit is gone at the moment they try to cancel.
                .contains("Deposits are non-refundable"));

        assertThat(attachmentsOf(message)).singleElement().satisfies(part -> {
            assertThat(part.getFileName()).isEqualTo("appointment.ics");
            assertThat(part.getContentType()).contains("text/calendar");
            assertThat(new String(part.getInputStream().readAllBytes(), StandardCharsets.UTF_8))
                    .contains("BEGIN:VEVENT")
                    .contains("DTSTART:20261014T110000Z");
        });
    }

    @Test
    @DisplayName("a held booking says it is not booked, and how long the hold lasts")
    void receivedIsNotAConfirmation() throws Exception {
        notifications.sendBookingReceived(
                SampleBooking.paris().awaitingDeposit(1350, "https://checkout.test/session").build());

        MimeMessage message = captured();
        assertThat(message.getSubject()).isEqualTo("We are holding your Haircut appointment");
        assertThat(textPartsOf(message)).allSatisfy(body -> assertThat(body)
                // D10: the customer must not read this as a confirmation. The deadline and the
                // deposit are what make the difference visible rather than a matter of tone.
                .contains("not booked yet")
                .contains("Wed 14 Oct, 12:00 CEST")
                .contains("https://checkout.test/session")
                .contains("€13.50"));
        assertThat(attachmentsOf(message))
                .as("nothing to put in a calendar until it is actually booked")
                .isEmpty();
    }

    @Test
    @DisplayName("a cancellation says who cancelled")
    void cancellationNamesItsSource() throws Exception {
        notifications.sendBookingCancelled(SampleBooking.paris().depositPaid(1350).build(),
                CancelledBy.BUSINESS);

        assertThat(textPartsOf(captured())).allSatisfy(body -> assertThat(body)
                .contains("we are sorry")
                // D7 once more, and this is the message where it matters most: it is the one a
                // customer reads immediately after the money stopped being refundable.
                .contains("non-refundable"));
    }

    @Test
    @DisplayName("a reminder offers the way out, which is the point of sending it")
    void reminderLinksToCancellation() throws Exception {
        notifications.sendBookingReminder(SampleBooking.paris().build());

        MimeMessage message = captured();
        assertThat(message.getSubject()).isEqualTo("Reminder: Haircut on Wed 14 Oct, 13:00 CEST");
        assertThat(textPartsOf(message)).allSatisfy(body -> assertThat(body)
                // A reminder a customer cannot act on produces a no-show instead of a cancellation.
                .contains("https://app.slotflow.test/booking/" + SampleBooking.CANCELLATION_TOKEN));
    }

    @Test
    @DisplayName("the two token mails state their expiry in words and as an instant")
    void tokenMailsExplainTheirExpiry() throws Exception {
        Instant inAnHour = clock.instant().plusSeconds(3600);

        notifications.sendPasswordReset(
                new NotificationService.Recipient("dana@example.test", "Dana Owner"),
                "reset-token", inAnHour);

        // The path, not the whole URL: the base comes from app.frontend.base-url, which is a
        // per-environment setting and not the thing this test is about. FrontendLinksTest pins the
        // route shape.
        assertThat(textPartsOf(captured())).allSatisfy(body -> assertThat(body)
                .contains("/reset-password/reset-token")
                .contains("1 hour")
                // D6: single use. A link that has silently stopped working is the most common
                // support request this flow generates, so both facts are stated.
                .contains("once"));
    }

    @Test
    @DisplayName("an invitation names the business and states its seven-day expiry")
    void invitationsExplainThemselves() throws Exception {
        Instant inAWeek = clock.instant().plusSeconds(7 * 24 * 3600);

        notifications.sendStaffInvitation(
                new NotificationService.Recipient("sam@example.test", "Sam Stylist"),
                "Dana Salon", "invite-token", inAWeek);

        MimeMessage message = captured();
        assertThat(message.getSubject()).isEqualTo("You have been invited to join Dana Salon");
        assertThat(textPartsOf(message)).allSatisfy(body -> assertThat(body)
                .contains("/accept-invitation/invite-token")
                .contains("Dana Salon")
                // Plan 06's expiry, stated in words and as an instant: "7 days" is what a reader
                // acts on, the timestamp is what they check on day six.
                .contains("7 days"));
    }

    @Test
    @DisplayName("a dead relay is retried once, then swallowed - it never reaches the caller")
    void aDeadRelayIsNotTheCallersProblem() {
        doThrow(new MailSendException("relay refused the connection"))
                .when(transport).send(any(MimeMessage.class));

        assertThatCode(() -> notifications.sendBookingConfirmed(SampleBooking.paris().build()))
                .doesNotThrowAnyException();

        // Twice and not three times: the failure this retry covers is a dropped connection, and
        // anything that fails twice is a bad address or a dead host, which asking again will not fix.
        verify(transport, timeout(SEND_TIMEOUT_MS).times(2)).send(any(MimeMessage.class));
    }

    // ---------------------------------------------------------------------------------
    //  reading a MimeMessage back
    // ---------------------------------------------------------------------------------

    private MimeMessage captured() throws Exception {
        ArgumentCaptor<MimeMessage> sent = ArgumentCaptor.forClass(MimeMessage.class);
        // The send is @Async, which is the property under test as much as the rendering is.
        verify(transport, timeout(SEND_TIMEOUT_MS)).send(sent.capture());
        MimeMessage message = sent.getValue();
        // What the real transport does immediately after this point, and what writes the headers.
        // Without it every part still reports the default text/plain, so an assertion on the
        // attachment's content type would be asserting on an unfinished message.
        message.saveChanges();
        return message;
    }

    /** The plaintext and HTML alternatives, whatever depth the multipart tree buried them at. */
    private static List<String> textPartsOf(MimeMessage message) throws Exception {
        List<String> bodies = new ArrayList<>();
        collect(message.getContent(), bodies, null);
        return bodies;
    }

    private static List<MimeBodyPart> attachmentsOf(MimeMessage message) throws Exception {
        List<MimeBodyPart> attachments = new ArrayList<>();
        collect(message.getContent(), null, attachments);
        return attachments;
    }

    /**
     * Walks the tree rather than assuming its shape. {@code MimeMessageHelper} nests a
     * {@code multipart/alternative} inside a {@code multipart/mixed} when there is an attachment
     * and does not when there is none, and a test that hard-coded either shape would be asserting
     * on Spring's internals instead of on the mail.
     */
    private static void collect(Object content, List<String> bodies,
            List<MimeBodyPart> attachments) throws Exception {
        if (content instanceof String text) {
            if (bodies != null) {
                bodies.add(text);
            }
            return;
        }
        if (content instanceof Multipart multipart) {
            for (int i = 0; i < multipart.getCount(); i++) {
                MimeBodyPart part = (MimeBodyPart) multipart.getBodyPart(i);
                if (part.getFileName() != null) {
                    if (attachments != null) {
                        attachments.add(part);
                    }
                } else {
                    collect(part.getContent(), bodies, attachments);
                }
            }
        }
    }
}
