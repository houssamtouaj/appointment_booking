package com.slotflow.notification;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The two things a hand-written {@code .ics} gets wrong, pinned.
 *
 * <p>Everything else in the file is a constant. The timestamp format and the text escaping are the
 * parts that vary with the data, and both fail in the same unhelpful way — the attachment simply
 * does nothing when the customer clicks it, or imports with half a title — so neither is
 * discoverable from a green build without these.
 */
class IcsCalendarTest {

    private static final Instant GENERATED_AT = Instant.parse("2026-10-13T08:30:00Z");

    @Test
    @DisplayName("timestamps are UTC basic format, and the event is the booking")
    void theEventIsWellFormed() {
        String ics = render(SampleBooking.paris().build());

        assertThat(ics)
                .startsWith("BEGIN:VCALENDAR")
                .contains("VERSION:2.0")
                .contains("METHOD:PUBLISH")
                // 13:00 Paris in October is 11:00 UTC. Written with no timezone reference at all,
                // so there is no VTIMEZONE to disagree with the reader's own database.
                .contains("DTSTART:20261014T110000Z")
                .contains("DTEND:20261014T120000Z")
                .contains("DTSTAMP:20261013T083000Z")
                // The booking id, so importing the confirmation and then the reminder leaves one
                // entry in the customer's calendar rather than two.
                .contains("UID:" + SampleBooking.BOOKING_ID + "@slotflow")
                .contains("SEQUENCE:0")
                .contains("STATUS:CONFIRMED")
                .endsWith("END:VCALENDAR\r\n");
    }

    @Test
    @DisplayName("every line ends CRLF, because the strict parsers reject anything else")
    void linesEndCrLf() {
        String ics = render(SampleBooking.paris().build());

        // Outlook is the one that cares, and its failure mode is silence.
        assertThat(ics.lines().count()).isGreaterThan(10);
        assertThat(ics.replace("\r\n", "")).doesNotContain("\n");
    }

    @Test
    @DisplayName("commas and semicolons in a business name are escaped, not swallowed")
    void textIsEscaped() {
        BookingNotification booking = SampleBooking.paris()
                .businessName("Dana, Clinic & Co; Paris")
                .serviceName("Cut \\ blow-dry")
                .build();

        String ics = render(booking);

        // An unescaped comma silently splits the property into a two-value list, so the calendar
        // entry loses half its title rather than failing in a way anybody would notice.
        assertThat(ics).contains("LOCATION:Dana\\, Clinic & Co\\; Paris");
        // The backslash is escaped first, or the escapes above would themselves be escaped again.
        assertThat(ics).contains("SUMMARY:Cut \\\\ blow-dry at Dana\\, Clinic & Co\\; Paris");
    }

    private static String render(BookingNotification booking) {
        return new String(IcsCalendar.forBooking(booking, GENERATED_AT), StandardCharsets.UTF_8);
    }
}
