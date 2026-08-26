package com.slotflow.notification;

import com.slotflow.notification.NotificationService.Recipient;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.mail.MailException;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Component;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

/**
 * Renders one message and hands it to SMTP. The only class in the application that touches
 * {@link JavaMailSender}.
 *
 * <h2>Every mail goes out in two formats</h2>
 * A {@code multipart/alternative} carrying HTML and a plaintext alternative, always, never one or
 * the other. The plaintext half is not a courtesy to 1998: it is what a screen reader, a watch
 * notification and a spam filter's content score all read, and an HTML-only transactional mail is
 * measurably more likely to be filed as junk — which for a booking confirmation means a customer
 * who believes they have no appointment. Both halves come from templates that live beside each
 * other, so writing one and forgetting the other fails at send time rather than producing a
 * silently degraded mail.
 *
 * <h2>Failure is logged against a reference, and retried exactly once</h2>
 * The caller is an {@code @Async} method with nobody to throw to, so an exception here is invisible
 * unless this class makes it visible. Every failure names the template and the thing it was about —
 * a booking id, an address — because "mail failed" without a reference is an alert nobody can act
 * on.
 *
 * <p>One retry, not a loop and not a queue. The failure this covers is the common one, a relay
 * dropping a connection it will accept a second later; anything that fails twice is a bad address,
 * a rejected sender or a dead host, and none of those are fixed by asking again. A durable outbox
 * with backoff is the right answer at a scale this project does not claim, and three retries with a
 * sleep would only make the failure slower to notice.
 */
@Component
class EmailSender {

    private static final Logger log = LoggerFactory.getLogger(EmailSender.class);

    private static final String CHARSET = StandardCharsets.UTF_8.name();

    /**
     * Where a template pair lives. The two files are {@code templates/email/<name>.html} and
     * {@code .txt}; see the class note on why both always exist.
     */
    private static final String TEMPLATE_PREFIX = "email/";

    /** An {@code .ics} on a confirmation, and nothing else so far. */
    record Attachment(String filename, String contentType, byte[] content) {
    }

    private final JavaMailSender transport;
    private final TemplateEngine templates;
    private final MailProperties properties;

    EmailSender(JavaMailSender transport, TemplateEngine templates, MailProperties properties) {
        this.transport = transport;
        this.templates = templates;
        this.properties = properties;
    }

    void send(String template, String subject, Recipient to, Map<String, Object> model,
              String reference) {
        send(template, subject, to, model, reference, null);
    }

    /**
     * @param reference what to log this by — a booking id, or an address for the two token flows.
     *                  It is the whole difference between an actionable error and a stack trace
     *                  with no subject
     */
    void send(String template, String subject, Recipient to, Map<String, Object> model,
              String reference, Attachment attachment) {
        MimeMessage message;
        try {
            message = compose(template, subject, to, model, attachment);
        } catch (MessagingException | RuntimeException couldNotRender) {
            // A missing template or a null in a model is a bug on this side, not a transport
            // problem, so it is not retried — the second attempt would fail identically.
            log.error("Could not build the {} mail for {}", template, reference, couldNotRender);
            return;
        }
        if (!deliver(message, template, reference, false)) {
            deliver(message, template, reference, true);
        }
    }

    /** @return whether it went out; a false has already been logged */
    private boolean deliver(MimeMessage message, String template, String reference,
                            boolean lastAttempt) {
        try {
            transport.send(message);
            return true;
        } catch (MailException undelivered) {
            if (lastAttempt) {
                log.error("Gave up sending the {} mail for {}", template, reference, undelivered);
            } else {
                log.warn("Retrying the {} mail for {}: {}", template, reference,
                        undelivered.getMessage());
            }
            return false;
        }
    }

    private MimeMessage compose(String template, String subject, Recipient to,
                                Map<String, Object> model, Attachment attachment)
            throws MessagingException {
        Context context = new Context();
        context.setVariables(model);

        MimeMessage message = transport.createMimeMessage();
        // Always multipart, attachment or not. Two bodies *is* a multipart message — the plaintext
        // and the HTML are alternatives inside it — and MimeMessageHelper refuses setText(text,
        // html) outright without this flag. Trying to be clever and pass `attachment != null` here
        // produced exactly that refusal for the five templates that carry no .ics.
        MimeMessageHelper helper = new MimeMessageHelper(message, true, CHARSET);
        helper.setFrom(properties.from());
        helper.setTo(to.email());
        helper.setSubject(subject);
        // Plaintext first, HTML second — that argument order is what makes the HTML the *preferred*
        // alternative. Reversed, every client shows the plaintext and the other template is wasted.
        helper.setText(render(template, ".txt", context), render(template, ".html", context));
        if (attachment != null) {
            helper.addAttachment(attachment.filename(),
                    new ByteArrayResource(attachment.content()), attachment.contentType());
        }
        return message;
    }

    private String render(String template, String extension, Context context) {
        return templates.process(TEMPLATE_PREFIX + template + extension, context);
    }
}
