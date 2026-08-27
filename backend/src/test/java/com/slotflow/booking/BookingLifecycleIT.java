package com.slotflow.booking;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.support.BookingScenario;
import com.slotflow.support.TestTime;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The transition matrix, through the endpoint that exposes it.
 *
 * <p>{@code BookingTransitionTest} already pins the matrix on the entity, with no Spring and no
 * database, which is where the rules belong and where twenty combinations cost milliseconds. What
 * this class adds is the half that unit test cannot see: that every refusal arrives as
 * {@code 409 ILLEGAL_TRANSITION} naming both states, that the two time guards are still armed when
 * the clock comes from the application rather than from a test constant, and that {@code CONFIRMED}
 * is refused from the outside even though the entity would allow it from {@code PENDING} (D2 — that
 * move belongs to the webhook and the sweeper, not to a button).
 *
 * <p>Every case in the factory below uses a booking that is already in the past, so the time guards
 * are satisfied and what is left is the structure of the matrix alone. The guards get their own two
 * tests, where a future booking is the whole point.
 */
class BookingLifecycleIT extends BookingScenario {

    // ---------------------------------------------------------------------------------
    //  the matrix
    // ---------------------------------------------------------------------------------

    /**
     * The four columns of the plan-10 matrix. {@code PENDING} is not among them: nothing puts a
     * booking on hold except a deposit going out, so it is a source state and never a target.
     */
    private static final List<BookingStatus> TARGETS = List.of(BookingStatus.CONFIRMED,
            BookingStatus.CANCELLED, BookingStatus.COMPLETED, BookingStatus.NO_SHOW);

    @TestFactory
    @DisplayName("every move in the matrix, as the API answers it")
    Stream<DynamicTest> theMatrixThroughTheEndpoint() {
        Salon salon = aSalon();
        List<DynamicTest> cases = new ArrayList<>();
        int index = 0;

        for (BookingStatus from : BookingStatus.values()) {
            for (BookingStatus to : TARGETS) {
                Instant startsAt = pastSlot(index++);
                boolean allowed = isAllowed(from, to);
                cases.add(DynamicTest.dynamicTest(from + " -> " + to + (allowed ? "" : " refused"),
                        () -> assertTransition(salon, from, to, startsAt, allowed)));
            }
        }
        return cases.stream();
    }

    /**
     * The matrix from plan 10, minus the one move the API does not offer.
     *
     * <p>{@code CONFIRMED} is reachable from {@code PENDING} on the entity and is <b>not</b>
     * reachable here, and that gap is the point of D2: a deposit arriving is what confirms a
     * booking. Plan 11's webhook calls {@code Booking.confirm()} directly, so the entity keeps the
     * move and the endpoint refuses it.
     */
    private static boolean isAllowed(BookingStatus from, BookingStatus to) {
        return switch (to) {
        case CANCELLED -> from != BookingStatus.CANCELLED && from != BookingStatus.COMPLETED;
        case COMPLETED -> from == BookingStatus.CONFIRMED || from == BookingStatus.NO_SHOW;
        case NO_SHOW -> from == BookingStatus.CONFIRMED;
        case CONFIRMED, PENDING -> false;
        };
    }

    private void assertTransition(Salon salon, BookingStatus from, BookingStatus to,
            Instant startsAt, boolean allowed) throws Exception {
        Booking booking = bookingIn(salon, from, startsAt);
        ResultActions result = patchStatus(salon, booking, to);

        if (allowed) {
            result.andExpect(status().isOk())
                    .andExpect(jsonPath("$.status").value(to.name()));
            assertThat(bookings.findById(booking.getId()).orElseThrow().getStatus()).isEqualTo(to);
        } else {
            result.andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("ILLEGAL_TRANSITION"))
                    // Both states in the body, because a client that optimistically flipped a badge
                    // needs to know what the server thinks the status is, not only that it said no.
                    .andExpect(jsonPath("$.from").value(from.name()))
                    .andExpect(jsonPath("$.to").value(to.name()));
            assertThat(bookings.findById(booking.getId()).orElseThrow().getStatus()).isEqualTo(from);
        }
    }

    // ---------------------------------------------------------------------------------
    //  the two time guards
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("COMPLETED before the appointment ends is refused, and allowed once it has")
    void completingEarlyIsRefused() throws Exception {
        Salon salon = aSalon();
        Instant tomorrow = TestTime.NOW.plus(1, ChronoUnit.DAYS);
        Booking booking = bookingIn(salon, BookingStatus.CONFIRMED, tomorrow);

        patchStatus(salon, booking, BookingStatus.COMPLETED)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ILLEGAL_TRANSITION"))
                .andExpect(jsonPath("$.detail")
                        .value("A CONFIRMED booking cannot become COMPLETED: "
                                + "the appointment has not finished yet"));

        // A completed booking in the future is a data-quality bug that resurfaces as a wrong number
        // on the dashboard, so the guard is on the clock and nothing overrides it — including an
        // owner. Moving the clock is what a test does instead of waiting.
        clock.setTo(tomorrow.plus(Duration.ofHours(2)));
        patchStatus(salon, booking, BookingStatus.COMPLETED)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"));
    }

    @Test
    @DisplayName("NO_SHOW before the appointment starts is refused, and allowed once it has")
    void markingANoShowEarlyIsRefused() throws Exception {
        Salon salon = aSalon();
        Instant tomorrow = TestTime.NOW.plus(1, ChronoUnit.DAYS);
        Booking booking = bookingIn(salon, BookingStatus.CONFIRMED, tomorrow);

        patchStatus(salon, booking, BookingStatus.NO_SHOW)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ILLEGAL_TRANSITION"));

        // One minute past the start is enough: somebody who has not walked in by their own start
        // time is a judgement the business is entitled to make, and the guard only stops it being
        // made before the appointment exists.
        clock.setTo(tomorrow.plus(Duration.ofMinutes(1)));
        patchStatus(salon, booking, BookingStatus.NO_SHOW)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NO_SHOW"));
    }

    // ---------------------------------------------------------------------------------
    //  what staff can do that customers cannot
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("staff cancel past the customer cutoff, and the slot is free again immediately")
    void staffIgnoreTheCancellationCutoff() throws Exception {
        Salon salon = solo(aSalon());
        PublicBookingResponse created = bookOk(salon, NINE_AM);

        // Inside the 24-hour cutoff: the customer is out of time.
        clock.setTo(NINE_AM.minus(Duration.ofHours(2)));
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CANCELLATION_CUTOFF"));

        // The business is not: the cutoff is a promise made to customers about how late they may
        // change their mind, and a salon whose stylist calls in sick has to be able to cancel.
        Booking booking = bookings.findById(created.id()).orElseThrow();
        patchStatus(salon, booking, BookingStatus.CANCELLED)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        clock.reset();
        book(salon, NINE_AM, salon.dana().getId(), "next@example.test")
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("a staff member, not only an owner, can work the calendar")
    void staffAndOwnersHaveTheSameCalendarRights() throws Exception {
        Salon salon = aSalon();
        Booking booking = bookingIn(salon, BookingStatus.CONFIRMED, pastSlot(40));

        mockMvc.perform(get("/api/bookings/{id}", booking.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(salon.sam())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.guest.email").value("alex@example.test"));

        mockMvc.perform(patch("/api/bookings/{id}/status", booking.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(salon.sam()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\": \"COMPLETED\"}"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("a status the enum does not have is a 400, not a 409 about the matrix")
    void anUnknownStatusIsAParseFailure() throws Exception {
        Salon salon = aSalon();
        Booking booking = bookingIn(salon, BookingStatus.CONFIRMED, pastSlot(50));

        mockMvc.perform(patch("/api/bookings/{id}/status", booking.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(salon.dana()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\": \"RESCHEDULED\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MALFORMED_REQUEST"));
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /**
     * A booking already in the given status, reached by walking the machine exactly as production
     * does. {@code BookingBuilder} deliberately offers no way to write a status straight onto a row,
     * because a fixture that does can build a state the application can never produce.
     */
    private Booking bookingIn(Salon salon, BookingStatus status, Instant startsAt) {
        Booking booking = status == BookingStatus.PENDING
                ? aBooking().forService(salon.service()).withStaff(salon.dana()).at(startsAt)
                        .awaitingDepositUntil(startsAt.minus(Duration.ofHours(1))).build()
                : aBooking().forService(salon.service()).withStaff(salon.dana()).at(startsAt)
                        .build();
        Instant afterwards = startsAt.plus(Duration.ofHours(3));
        switch (status) {
        case PENDING, CONFIRMED -> {
        }
        case CANCELLED -> booking.cancel();
        case COMPLETED -> booking.complete(afterwards);
        case NO_SHOW -> booking.markNoShow(afterwards);
        }
        return bookings.save(booking);
    }

    /**
     * A start well in the past, spaced so that two cases can never collide in the exclusion
     * constraint — which they otherwise would, since every one of them books the same staff member.
     */
    private static Instant pastSlot(int index) {
        return TestTime.NOW.minus(Duration.ofDays(2L * index + 2));
    }

    private ResultActions patchStatus(Salon salon, Booking booking, BookingStatus target)
            throws Exception {
        return mockMvc.perform(patch("/api/bookings/{id}/status", booking.getId())
                .header(HttpHeaders.AUTHORIZATION, bearer(salon.dana()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"status\": \"%s\"}".formatted(target)));
    }
}
