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

    private static final String CRLF = "\r\n";

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

    @Test
    @DisplayName("no content line exceeds 75 octets, and unfolding gives the original back")
    void longLinesAreFolded() {
        // The defaults: "Dana Salon", staff "Dana Owner", and a manage URL with a UUID in it.
        BookingNotification booking = SampleBooking.paris().build();

        String ics = render(booking);

        // The cap is on octets of the encoded form, not characters, and a strict parser handed an
        // over-long line truncates the property or rejects the file.
        assertThat(ics.split(CRLF))
                .allSatisfy(line -> assertThat(line.getBytes(StandardCharsets.UTF_8).length)
                        .as("line \"%s\"", line)
                        .isLessThanOrEqualTo(75));

        // A DESCRIPTION with a manage URL in it is well over the cap, so this test would pass
        // vacuously if nothing had folded.
        assertThat(ics).contains(CRLF + " ");

        // Unfolding is stripping CRLF-space, and it has to give back exactly what went in -
        // otherwise the fold has eaten a character or added one.
        assertThat(unfold(ics)).contains(
                "DESCRIPTION:With Dana Owner. Manage this booking: " + booking.manageUrl());
        assertThat(unfold(ics)).contains("URL:" + booking.manageUrl());
    }

    @Test
    @DisplayName("a fold never lands inside a multi-byte character")
    void foldsFallOnCharacterBoundaries() {
        // Every character is two octets, so a fold that counted characters, or that cut at a fixed
        // octet without backing off, splits one in half. The line is long enough to fold twice.
        String accented = "é".repeat(90);
        BookingNotification booking = SampleBooking.paris().businessName(accented).build();

        String ics = render(booking);

        // Decoding is the assertion. A cut inside a two-octet sequence produces replacement
        // characters here, and every one of them is a character the reader never sees.
        assertThat(ics).doesNotContain("\ufffd");
        assertThat(unfold(ics)).contains("LOCATION:" + accented);
    }

    /** RFC 5545 §3.1 unfolding: a CRLF followed by one space was never there. */
    private static String unfold(String ics) {
        return ics.replace(CRLF + " ", "");
    }

    private static String render(BookingNotification booking) {
        return new String(IcsCalendar.forBooking(booking, GENERATED_AT), StandardCharsets.UTF_8);
    }
}
