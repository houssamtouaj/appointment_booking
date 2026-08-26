package com.slotflow.notification;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Whether this deployment sends mail, and who it says it is from.
 *
 * <p>Note the namespace: {@code app.mail} is this application's decision about mail, and
 * {@code spring.mail} is Boot's SMTP connection. They are deliberately not the same prefix —
 * a relay host is infrastructure, and "does this environment mail at all" is a product switch
 * that also has to be answerable when the host is set and unreachable.
 *
 * <p><b>On by default.</b> The opposite would be a deployment that quietly sends nothing, which
 * looks identical to a working one right up until a customer says they never got a confirmation.
 * {@link LoggingNotificationService} has to be asked for.
 *
 * @param enabled false selects {@link LoggingNotificationService}: no SMTP, no templates, every
 *                message and its links written to the log instead. The demo profile
 * @param from    the envelope sender. A configured value rather than a constant because a relay
 *                will refuse a {@code From} it does not own, and that address differs per deploy
 */
@ConfigurationProperties(prefix = "app.mail")
public record MailProperties(boolean enabled, String from) {

    public MailProperties {
        from = from == null || from.isBlank() ? "no-reply@slotflow.local" : from.trim();
    }
}
