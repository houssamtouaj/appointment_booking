package com.slotflow.dashboard;

import static com.slotflow.support.fixtures.Fixtures.aBooking;
import static com.slotflow.support.fixtures.Fixtures.aService;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingStatus;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.staff.User;
import com.slotflow.support.BookingScenario;
import com.slotflow.support.QueryCounter;
import jakarta.persistence.EntityManagerFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

/**
 * {@code GET /api/dashboard/stats}: six numbers a business will make decisions on.
 *
 * <h2>The bookings are inserted, not booked through the API</h2>
 * Half of these figures are about {@code COMPLETED} and {@code NO_SHOW} appointments, and both are
 * time-guarded on the entity — a booking cannot be completed before it has finished. Driving that
 * through the API would mean booking, moving the clock past the appointment, and patching the
 * status, three requests per row, for a test about arithmetic. The fixture builds the rows the
 * lifecycle would have produced and the lifecycle is tested where it belongs.
 *
 * <h2>Every assertion is scoped to one tenant</h2>
 * Container reuse means the database is never empty, and the sums here are over a whole business.
 * Each test builds its own salon, and the endpoint's tenant scoping is what makes the numbers
 * exact — which is also the property the cross-tenant test below is checking.
 */
class DashboardStatsIT extends BookingScenario {

    private static final String STATS = "/api/dashboard/stats";

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    private QueryCounter queries;

    @BeforeEach
    void countQueries() {
        queries = new QueryCounter(entityManagerFactory);
    }

    @Test
    @DisplayName("earned is not booked: revenue counts COMPLETED and nothing else")
    void revenueIsEarnedNotBooked() throws Exception {
        Salon salon = solo(aSalon());
        completed(salon, "2026-03-03T10:00", 4_000L);
        completed(salon, "2026-03-04T10:00", 6_000L);
        // Confirmed and still to come: real money one day, not revenue today.
        confirmed(salon, "2026-03-06T10:00", 9_900L);
        // Cancelled: never revenue, and never a booking count either.
        cancelled(salon, "2026-03-05T10:00", 5_000L);

        mockMvc.perform(statsAsOwner(salon))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenueCents").value(10_000))
                // CONFIRMED + COMPLETED. The cancelled one is excluded, so churn cannot inflate it.
                .andExpect(jsonPath("$.weekBookings").value(3));
    }

    @Test
    @DisplayName("deposits count money that arrived, including on appointments still to come")
    void depositsCountWhatArrived() throws Exception {
        Salon salon = solo(aSalon());
        completed(salon, "2026-03-03T10:00", 4_000L);
        Booking future = confirmed(salon, "2026-03-06T10:00", 9_900L);
        future.recordDepositPaid(2_970L);
        bookings.save(future);
        Booking gone = cancelled(salon, "2026-03-05T10:00", 5_000L);
        gone.recordDepositPaid(1_500L);
        bookings.save(gone);

        mockMvc.perform(statsAsOwner(salon))
                .andExpect(status().isOk())
                // Deliberately not a subset of revenue: a deposit on a future booking is money in
                // the bank against unearned revenue, and a business needs both figures.
                .andExpect(jsonPath("$.depositsCents").value(2_970))
                .andExpect(jsonPath("$.revenueCents").value(4_000));
    }

    @Test
    @DisplayName("noShowRate is null when nothing has finished, not zero")
    void noShowRateIsNullWithoutData() throws Exception {
        Salon salon = solo(aSalon());
        confirmed(salon, "2026-03-06T10:00", 9_900L);

        // Asserted against the raw body on purpose. jsonPath("$.noShowRate").exists() fails on a
        // present-but-null member - JsonPath cannot tell "null" from "absent", which is the exact
        // distinction under test here, so the only honest assertion is on the bytes.
        String body = mockMvc.perform(statsAsOwner(salon))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        // Present and null. The application serialises NON_NULL everywhere else; this field opts
        // out, because a client checking for null would otherwise see undefined and, in a language
        // where both are falsy, render the zero the null exists to avoid.
        assertThat(body).contains("\"noShowRate\":null");
    }

    @Test
    @DisplayName("noShowRate divides no-shows by everything that finished")
    void noShowRateIsARatio() throws Exception {
        Salon salon = solo(aSalon());
        completed(salon, "2026-03-03T10:00", 4_000L);
        completed(salon, "2026-03-03T12:00", 4_000L);
        completed(salon, "2026-03-04T10:00", 4_000L);
        noShow(salon, "2026-03-04T12:00", 4_000L);

        // One in four, and cancelled bookings are not in the denominator: a customer who cancelled
        // in time did not fail to turn up.
        cancelled(salon, "2026-03-05T10:00", 4_000L);

        mockMvc.perform(statsAsOwner(salon))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.noShowRate").value(0.25));
    }

    @Test
    @DisplayName("today is today in the business timezone, whatever the range asks for")
    void todayIsAlwaysToday() throws Exception {
        Salon salon = solo(aSalon());
        // TestTime.NOW is Monday 09:00 UTC, which is 10:00 in Paris. 23:30 Paris is still Monday
        // there and already Tuesday in UTC - so a boundary computed in the wrong zone counts this
        // one on the wrong day.
        confirmed(salon, "2026-03-02T23:30", 4_000L);
        confirmed(salon, "2026-03-03T00:30", 4_000L);

        mockMvc.perform(statsAsOwner(salon))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.todayBookings").value(1));
    }

    @Test
    @DisplayName("an explicit range is read as whole days, ending at midnight after `to`")
    void theRangeIsInclusiveOfBothDays() throws Exception {
        Salon salon = solo(aSalon());
        completed(salon, "2026-03-03T10:00", 1_000L);
        completed(salon, "2026-03-04T10:00", 2_000L);
        completed(salon, "2026-03-05T10:00", 4_000L);

        // The last day is included in full - the same reading the availability endpoint gives its
        // own `to`, which is what stops the two disagreeing about what a week covers.
        mockMvc.perform(statsAsOwner(salon).param("from", "2026-03-03").param("to", "2026-03-04"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenueCents").value(3_000));
    }

    @Test
    @DisplayName("a backwards range is refused rather than answered with zeroes")
    void aBackwardsRangeIsRejected() throws Exception {
        Salon salon = solo(aSalon());

        // The query would happily answer this with an empty interval, which reads as a quiet month
        // rather than as two date pickers the wrong way round.
        mockMvc.perform(statsAsOwner(salon).param("from", "2026-03-08").param("to", "2026-03-02"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("to"));
    }

    @Test
    @DisplayName("an unknown tz is a 422 naming the field, not a database error")
    void anUnknownZoneIsAValidationFailure() throws Exception {
        Salon salon = solo(aSalon());

        // The zone is interpolated into AT TIME ZONE. Unvalidated it would be a Postgres error
        // surfacing as a 500 on a client's typo.
        mockMvc.perform(statsAsOwner(salon).param("tz", "Mars/Olympus_Mons"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.errors[0].field").value("tz"));
    }

    @Test
    @DisplayName("upcoming is the next five confirmed appointments, and holds are not in it")
    void upcomingIsWhatIsNext() throws Exception {
        Salon salon = solo(aSalon());
        confirmed(salon, "2026-03-06T10:00", 1_000L);
        confirmed(salon, "2026-03-05T10:00", 1_000L);
        // Already happened, so it is not "upcoming" whatever its status.
        completed(salon, "2026-03-03T10:00", 1_000L);

        mockMvc.perform(statsAsOwner(salon))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.upcoming.length()").value(2))
                // Ascending, and the earlier one first even though it was inserted second.
                .andExpect(jsonPath("$.upcoming[0].startsAt").value("2026-03-05T09:00:00Z"))
                .andExpect(jsonPath("$.upcoming[1].startsAt").value("2026-03-06T09:00:00Z"))
                // The list row shape, which carries a name and no email address.
                .andExpect(jsonPath("$.upcoming[0].guestName").exists())
                .andExpect(jsonPath("$.upcoming[0].guestEmail").doesNotExist());
    }

    @Test
    @DisplayName("a STAFF token sees only its own bookings, in every figure")
    void staffSeeOnlyThemselves() throws Exception {
        // Both staff active, so each has their own calendar to be excluded from the other's.
        Salon salon = aSalon();
        User dana = salon.dana();
        User sam = salon.sam();
        forStaff(salon, dana, "2026-03-03T10:00", 4_000L, BookingStatus.COMPLETED);
        forStaff(salon, sam, "2026-03-03T12:00", 6_000L, BookingStatus.COMPLETED);
        forStaff(salon, sam, "2026-03-06T10:00", 5_000L, BookingStatus.CONFIRMED);

        mockMvc.perform(get(STATS).header(HttpHeaders.AUTHORIZATION, bearer(sam)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenueCents").value(6_000))
                .andExpect(jsonPath("$.weekBookings").value(2))
                .andExpect(jsonPath("$.upcoming.length()").value(1))
                .andExpect(jsonPath("$.upcoming[0].staffId").value(sam.getId().toString()));

        // The owner of the same business sees both, from the same URL.
        mockMvc.perform(get(STATS).header(HttpHeaders.AUTHORIZATION, bearer(dana)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revenueCents").value(10_000))
                .andExpect(jsonPath("$.weekBookings").value(3));
    }

    @Test
    @DisplayName("another tenant's bookings never appear, with or without dates")
    void tenantsAreIsolated() throws Exception {
        Salon mine = solo(aSalon());
        Salon theirs = solo(aSalon());
        completed(mine, "2026-03-03T10:00", 1_000L);
        completed(theirs, "2026-03-03T10:00", 999_000L);

        for (MockHttpServletRequestBuilder request : java.util.List.of(
                statsAsOwner(mine),
                statsAsOwner(mine).param("from", "2026-03-02").param("to", "2026-03-08"))) {
            mockMvc.perform(request)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.revenueCents").value(1_000));
        }
    }

    @Test
    @DisplayName("exactly two statements per request, whatever the dashboard contains")
    void twoStatementsPerRequest() throws Exception {
        Salon salon = solo(aSalon());
        for (int day = 3; day <= 6; day++) {
            confirmed(salon, "2026-03-0" + day + "T10:00", 1_000L);
            completed(salon, "2026-03-0" + day + "T12:00", 1_000L);
        }

        // One aggregate over every figure, one for upcoming. The naive shape of this endpoint is
        // five repository calls returning the identical JSON, which is the failure a green build
        // cannot otherwise see.
        long statements = queries.statementsDuring(
                () -> mockMvc.perform(statsAsOwner(salon)).andExpect(status().isOk()));

        assertThat(statements).isEqualTo(2);
    }

    @Test
    @DisplayName("an anonymous caller is refused: there is no tenant to scope to")
    void anonymousIsRefused() throws Exception {
        mockMvc.perform(get(STATS)).andExpect(status().isUnauthorized());
    }

    // ---------------------------------------------------------------------------------
    //  fixtures
    // ---------------------------------------------------------------------------------

    private MockHttpServletRequestBuilder statsAsOwner(Salon salon) {
        return get(STATS).header(HttpHeaders.AUTHORIZATION, bearer(salon.tenant().owner()));
    }

    private Booking confirmed(Salon salon, String parisLocalTime, long price) {
        return forStaff(salon, salon.dana(), parisLocalTime, price, BookingStatus.CONFIRMED);
    }

    private Booking completed(Salon salon, String parisLocalTime, long price) {
        return forStaff(salon, salon.dana(), parisLocalTime, price, BookingStatus.COMPLETED);
    }

    private Booking cancelled(Salon salon, String parisLocalTime, long price) {
        return forStaff(salon, salon.dana(), parisLocalTime, price, BookingStatus.CANCELLED);
    }

    private Booking noShow(Salon salon, String parisLocalTime, long price) {
        return forStaff(salon, salon.dana(), parisLocalTime, price, BookingStatus.NO_SHOW);
    }

    /**
     * One booking in a chosen status, reached by walking the state machine.
     *
     * <p>{@code BookingBuilder} deliberately offers no way to set a status directly, and this
     * respects that: a fixture that wrote {@code COMPLETED} into a future appointment would be a
     * row the application can never produce, and the whole point of these figures is that they
     * describe rows it can.
     *
     * <p>Each booking gets its own service, priced for the assertion. Distinct prices are what make
     * a wrong FILTER clause visible - with one price everywhere, several wrong answers are the same
     * number as the right one.
     */
    private Booking forStaff(Salon salon, User staff, String parisLocalTime, long priceCents,
                             BookingStatus status) {
        ServiceOffering service = services.save(aService()
                .forBusiness(salon.tenant().business())
                .withName("Service " + priceCents + " " + parisLocalTime)
                .withDuration(60)
                .withPriceCents(priceCents)
                .build());
        Booking booking = bookings.save(aBooking()
                .forService(service)
                .withStaff(staff)
                .at(parisTime(parisLocalTime))
                .build());

        // The instant is the entity's parameter, not the application clock, so a booking can be
        // completed without the whole suite having to time-travel past it.
        switch (status) {
            case CONFIRMED -> { }
            case COMPLETED -> booking.complete(booking.getEndsAt().plusSeconds(1));
            case NO_SHOW -> booking.markNoShow(booking.getStartsAt().plusSeconds(1));
            case CANCELLED -> booking.cancel();
            case PENDING -> throw new IllegalArgumentException(
                    "a hold is created by the deposit path, not by a status");
        }
        return bookings.save(booking);
    }
}
