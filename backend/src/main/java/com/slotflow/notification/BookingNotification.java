package com.slotflow.notification;

import com.slotflow.notification.NotificationService.Recipient;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Currency;
import java.util.Locale;
import java.util.UUID;

/**
 * Everything a booking email needs, resolved once and flattened.
 *
 * <p><b>Not the entity, and not lazily anything.</b> The send happens after commit and on another
 * thread, outside the persistence context that loaded the row, so anything that still needs a
 * database to answer a question is a {@code LazyInitializationException} waiting for whichever
 * template touches it first. {@link BookingNotifier} does all four reads while it still has a
 * transaction and hands the result over as values.
 *
 * <p><b>The display strings are computed here, not in the templates.</b> Six templates formatting
 * the same instant is six chances to render {@code 15:00} without saying where — and "15:00 in
 * which timezone" is the single most expensive ambiguity a booking confirmation can contain (plan
 * 12). {@link #whenText()} cannot produce a bare time, because the format has the zone in it.
 *
 * @param cancellationToken the customer's only credential, and what the manage link is built from.
 *                          Present so a template can say "cancel" without this record having to
 *                          know the SPA's routes — {@code FrontendLinks} owns those
 * @param staffName         who they are seeing. A booking always has one; "anybody" is resolved to
 *                          a person at creation, never left open
 * @param depositDueCents   what Stripe is being asked for, from {@code Business.depositFor} and
 *                          never from a request body. Zero when no deposit is owed
 * @param depositPaidCents  what actually arrived. Zero until the webhook says otherwise
 * @param holdExpiresAt     when an unpaid hold lapses (D3). Null once the booking is confirmed —
 *                          there is nothing in flight to time out
 * @param checkoutUrl       Stripe's hosted page, for the received email and the manage page. Null
 *                          when no deposit is owed, or when payments are switched off
 */
public record BookingNotification(
        Recipient recipient,
        UUID bookingId,
        UUID cancellationToken,
        String businessName,
        ZoneId businessZone,
        String serviceName,
        String staffName,
        Instant startsAt,
        Instant endsAt,
        Currency currency,
        long priceCents,
        long depositDueCents,
        long depositPaidCents,
        Instant holdExpiresAt,
        String checkoutUrl,
        String manageUrl) {

    /**
     * "Tue 14 Oct, 15:00 CEST".
     *
     * <p>{@code zzz} is the load-bearing part. Without it this is a number a customer has to guess
     * the meaning of, and the guess that costs a business an appointment is a customer in a
     * different country reading their own wall clock. {@code Locale.ENGLISH} rather than the JVM
     * default: the templates are English, and a French build server must not send half a sentence
     * in French.
     */
    private static final DateTimeFormatter WHEN =
            DateTimeFormatter.ofPattern("EEE d MMM, HH:mm zzz", Locale.ENGLISH);

    /** Same day, so the end needs no date — "until 16:00". */
    private static final DateTimeFormatter UNTIL =
            DateTimeFormatter.ofPattern("HH:mm zzz", Locale.ENGLISH);

    /** When the appointment starts, in the business's own timezone (D11). */
    public String whenText() {
        return WHEN.format(inBusinessZone(startsAt));
    }

    /** When it ends. Rendered without the date, because an appointment does not span midnight. */
    public String untilText() {
        return UNTIL.format(inBusinessZone(endsAt));
    }

    /** When an unpaid hold lapses, or null when nothing is being held. */
    public String holdExpiresText() {
        return holdExpiresAt == null ? null : WHEN.format(inBusinessZone(holdExpiresAt));
    }

    public String priceText() {
        return Money.format(priceCents, currency);
    }

    public String depositDueText() {
        return Money.format(depositDueCents, currency);
    }

    public String depositPaidText() {
        return Money.format(depositPaidCents, currency);
    }

    /** What is still owed at the appointment, given what the deposit already covered. */
    public String outstandingText() {
        return Money.format(priceCents - depositPaidCents, currency);
    }

    public String guestName() {
        return recipient.fullName();
    }

    private ZonedDateTime inBusinessZone(Instant instant) {
        return ZonedDateTime.ofInstant(instant, businessZone);
    }

    /**
     * Identity only.
     *
     * <p>The generated one would print a name, an email address and a price, and this record is an
     * argument to an {@code @Async} method — so the default would end up in
     * {@code AsyncConfig}'s uncaught-exception log, in whatever aggregator the deploy ships logs
     * to, every time a relay is down. The booking id is what anybody debugging actually greps for.
     */
    @Override
    public String toString() {
        return "BookingNotification[booking=" + bookingId + "]";
    }
}
