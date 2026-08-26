package com.slotflow.notification;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * The {@code .ics} attachment on a confirmation, written by hand.
 *
 * <p>Twenty lines of RFC 5545 against a calendaring library is a deliberate trade. The library
 * would bring a timezone database, a recurrence engine and a parser this application has no use
 * for; what is needed is one non-recurring {@code VEVENT} with a fixed set of properties, and the
 * two things that are actually easy to get wrong — the UTC timestamp format and the text escaping —
 * are each three lines and are each covered by {@code IcsCalendarTest}.
 *
 * <h2>UTC, with the {@code Z} suffix</h2>
 * A {@code DTSTART} written as a local time needs a {@code VTIMEZONE} block travelling with it, and
 * a {@code VTIMEZONE} that disagrees with the reader's own database moves the appointment by an
 * hour twice a year. Every instant in this schema is UTC already, so the form with no timezone at
 * all is both simpler and the one that cannot drift. The customer's calendar renders it in whatever
 * zone the customer is in, which is the correct behaviour and the one the email's own "15:00 CEST"
 * line exists to reconcile with.
 *
 * <h2>{@code UID} is the booking id</h2>
 * Which makes the file idempotent in the customer's calendar: the reminder and the confirmation
 * carry the same event, so importing both leaves one entry rather than two. It is also why
 * {@code SEQUENCE} is present and zero — a future revision of a booking would raise it, and a
 * calendar that never sees the property has no way to be told that anything changed.
 *
 * <h2>Line endings are CRLF, and that is not cosmetic</h2>
 * RFC 5545 specifies CRLF, and the strict parsers — Outlook among them — reject a file that uses
 * bare newlines. That failure shows up as "the attachment does nothing when I click it", which is
 * the least diagnosable bug this feature can have.
 *
 * <h2>Lines are folded at 75 octets, and that is the same bug</h2>
 * RFC 5545 §3.1 also caps a content line at 75 octets, continuing it on the next line indented by
 * one space. A {@code DESCRIPTION} carrying a manage URL with a UUID in it is comfortably over the
 * cap, and a strict parser handed an over-long line truncates the property or rejects the file —
 * arriving as the same undiagnosable silence as a bare newline. The fold counts octets rather than
 * characters, because the limit is on the encoded form, and it never cuts a character in half.
 */
final class IcsCalendar {

    /** {@code 20261014T130000Z}. Basic format, UTC, no separators — see the class note. */
    private static final DateTimeFormatter STAMP =
            DateTimeFormatter.ofPattern("yyyyMMdd'T'HHmmss'Z'", Locale.ROOT)
                    .withZone(ZoneOffset.UTC);

    private static final String CRLF = "\r\n";

    /** RFC 5545 §3.1, counted in octets of the encoded form and excluding the break. */
    private static final int LIMIT = 75;

    private IcsCalendar() {
    }

    /**
     * @param generatedAt what goes in {@code DTSTAMP} — when this file was produced, which is
     *                    distinct from when the appointment is and is taken from the application
     *                    clock rather than from {@code Instant.now()} so a test can pin it
     */
    static byte[] forBooking(BookingNotification booking, Instant generatedAt) {
        String body = fold(
                "BEGIN:VCALENDAR",
                "VERSION:2.0",
                "PRODID:-//SlotFlow//Booking//EN",
                "CALSCALE:GREGORIAN",
                "METHOD:PUBLISH",
                "BEGIN:VEVENT",
                "UID:" + booking.bookingId() + "@slotflow",
                "SEQUENCE:0",
                "DTSTAMP:" + STAMP.format(generatedAt),
                "DTSTART:" + STAMP.format(booking.startsAt()),
                "DTEND:" + STAMP.format(booking.endsAt()),
                "SUMMARY:" + escape(booking.serviceName() + " at " + booking.businessName()),
                "DESCRIPTION:" + escape("With " + booking.staffName()
                        + ". Manage this booking: " + booking.manageUrl()),
                "LOCATION:" + escape(booking.businessName()),
                "URL:" + escape(booking.manageUrl()),
                "STATUS:CONFIRMED",
                "END:VEVENT",
                "END:VCALENDAR") + CRLF;
        return body.getBytes(StandardCharsets.UTF_8);
    }

    /**
     * Every content line, folded and joined with CRLF.
     *
     * <p>The continuation marker is CRLF plus one space, and that space counts against the next
     * line's 75 — which is why a continuation carries 74 octets of content and the first line
     * carries 75. Unfolding is the exact reverse: a reader strips CRLF-space and the original line
     * comes back, escapes and all, so a fold is free to land inside an escaped pair.
     *
     * <p>What it must not land inside is a UTF-8 character. A business name one {@code é} outside
     * ASCII is a two-octet sequence that a naive cut would split across the fold — which unfolds to
     * the same bytes but is not valid UTF-8 while it is on the wire, and that is enough for a strict
     * reader to give up on the file. So the cut backs off over any trailing octet first.
     */
    private static String fold(String... lines) {
        StringBuilder folded = new StringBuilder();
        for (String line : lines) {
            if (!folded.isEmpty()) {
                folded.append(CRLF);
            }
            appendFolded(folded, line);
        }
        return folded.toString();
    }

    private static void appendFolded(StringBuilder target, String line) {
        byte[] octets = line.getBytes(StandardCharsets.UTF_8);
        if (octets.length <= LIMIT) {
            target.append(line);
            return;
        }
        int start = 0;
        while (start < octets.length) {
            boolean continuation = start > 0;
            int end = Math.min(start + (continuation ? LIMIT - 1 : LIMIT), octets.length);
            while (end > start + 1 && end < octets.length && isTrailingOctet(octets[end])) {
                end--;
            }
            if (continuation) {
                target.append(CRLF).append(' ');
            }
            target.append(new String(octets, start, end - start, StandardCharsets.UTF_8));
            start = end;
        }
    }

    /** {@code 10xxxxxx} — the second, third or fourth octet of a UTF-8 character. */
    private static boolean isTrailingOctet(byte octet) {
        return (octet & 0xC0) == 0x80;
    }

    /**
     * RFC 5545 §3.3.11. The backslash goes first, or the escapes this method adds get escaped
     * again on the next pass.
     *
     * <p>A business called "Dana, Clinic &amp; Co" is not a hypothetical, and an unescaped comma
     * silently splits the property into a two-value list — so the calendar entry loses half its
     * title rather than failing in a way anybody would notice.
     */
    private static String escape(String value) {
        return value.replace("\\", "\\\\")
                .replace(";", "\\;")
                .replace(",", "\\,")
                .replace("\r\n", "\\n")
                .replace("\n", "\\n");
    }
}
