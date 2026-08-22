package com.slotflow.booking;

import static com.slotflow.support.fixtures.Fixtures.aService;
import static com.slotflow.support.fixtures.Fixtures.anOverride;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.core.type.TypeReference;
import com.slotflow.availability.AvailabilityOverrideRepository;
import com.slotflow.availability.SlotResponse;
import com.slotflow.business.BookingPolicy;
import com.slotflow.catalog.ServiceOffering;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * The wave-6 exit demo, and every refusal on the way to it.
 *
 * <p>The first test is the demo end to end: copy a start out of the availability response, book it,
 * watch it and its buffers leave the calendar, fail to book it twice, cancel it, watch it come back.
 * Everything after that is one refusal each, because "a start the engine never offered is a 422
 * with a specific code, and one somebody else already has is a 409" is the distinction this endpoint
 * is built around, and the one a reader will want to see asserted rather than described.
 *
 * <p>{@code BookingConcurrencyIT} owns the race. This class only ever books sequentially.
 */
class BookingCreationIT extends BookingScenario {

    @Autowired
    private AvailabilityOverrideRepository overrides;

    // ---------------------------------------------------------------------------------
    //  the exit demo
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("book a slot, lose it and its buffers from the calendar, fail to rebook, cancel, "
            + "and have it back")
    void theWholeRoundTrip() throws Exception {
        Salon salon = solo(aSalonWithBuffers(15, 15));

        // 1. Copy a start out of the availability response, exactly as the booking page does.
        List<Instant> before = startsOn(salon);
        Instant noon = parisTime("2026-03-04T12:00");
        assertThat(before).as("the demo starts from a slot the API actually offered").contains(noon);

        PublicBookingResponse created = book(salon, noon)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("CONFIRMED"))
                // UTC on the wire: Paris is on CET in early March, so noon local is 11:00Z.
                .andExpect(jsonPath("$.startsAt").value("2026-03-04T11:00:00Z"))
                .andExpect(jsonPath("$.endsAt").value("2026-03-04T12:00:00Z"))
                .andExpect(jsonPath("$.priceCents").value(5000))
                .andExpect(jsonPath("$.currency").value("EUR"))
                .andExpect(jsonPath("$.staffId").value(salon.dana().getId().toString()))
                // D7, in the response that created the booking and not only on the manage page: the
                // customer is told before they can ever be surprised.
                .andExpect(jsonPath("$.depositRefundable").value(false))
                .andExpect(jsonPath("$.cancellationToken").isNotEmpty())
                // Payments are off this wave, so nothing is ever PENDING and nothing is held.
                .andExpect(jsonPath("$.expiresAt").doesNotExist())
                .andExpect(jsonPath("$.checkoutUrl").doesNotExist())
                .andReturn().getResponse().getContentAsString()
                .transform(this::asBooking);

        // 2. The slot is gone, and so is every start whose own buffers reach into what it took:
        //    12:00-13:00 plus fifteen minutes either side costs the calendar 11:45-13:15.
        List<Instant> neighbours = List.of(parisTime("2026-03-04T11:30"),
                parisTime("2026-03-04T12:30"), parisTime("2026-03-04T13:00"));
        assertThat(before).containsAll(neighbours);
        assertThat(startsOn(salon))
                .as("D4: a booking takes the slots its buffers cover, not only the one it fills")
                .doesNotContain(noon)
                .doesNotContainAnyElementsOf(neighbours);

        // 3. The same slot again is a conflict, and the body says which offer to retire.
        book(salon, noon)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOOKING_SLOT_TAKEN"))
                .andExpect(jsonPath("$.startsAt").value("2026-03-04T11:00:00Z"))
                .andExpect(jsonPath("$.endsAt").value("2026-03-04T12:00:00Z"))
                // No staffId, because this request named nobody. An any-staff conflict means every
                // candidate is blocked — otherwise one of them would have taken it — so the offer
                // to retire is the slot itself, and inventing a person to blame would be noise.
                .andExpect(jsonPath("$.staffId").doesNotExist());

        // 4. Cancelling frees it immediately: the exclusion constraint stops matching a cancelled
        //    row, so nothing stands between the cancel and the next customer.
        mockMvc.perform(delete("/api/public/bookings/{token}", created.cancellationToken()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"))
                .andExpect(jsonPath("$.depositRefundable").value(false));

        assertThat(startsOn(salon))
                .as("a cancelled booking releases its slot the instant the transaction commits")
                .containsExactlyElementsOf(before);
        book(salon, noon).andExpect(status().isCreated());
    }

    // ---------------------------------------------------------------------------------
    //  the fast refusals
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("a deactivated service is 422 SERVICE_INACTIVE, and another tenant's is 404")
    void serviceRefusals() throws Exception {
        Salon salon = aSalon();
        ServiceOffering haircut = services.findById(salon.serviceId()).orElseThrow();
        haircut.deactivate();
        services.save(haircut);

        book(salon, NINE_AM)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SERVICE_INACTIVE"));

        // Never 403: an unauthenticated endpoint that distinguished "not yours" from "not there"
        // would be an existence oracle over every service id in the product.
        ServiceOffering elsewhere =
                services.save(aService().forBusiness(aTenant().business()).build());
        mockMvc.perform(bookRequest(salon.slug(), elsewhere.getId(), NINE_AM, null,
                        "alex@example.test"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("a staff member who does not perform the service is 422 STAFF_NOT_ASSIGNED")
    void staffRefusals() throws Exception {
        Salon salon = aSalon();

        book(salon, NINE_AM, aStaffMemberOf(salon.tenant()).getId(), "alex@example.test")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("STAFF_NOT_ASSIGNED"));

        // The same code when nobody at all performs it. The availability endpoint answers that with
        // an empty list, which is the right answer to "show me the menu"; a booking has to be told
        // why the calendar it is staring at will never fill in.
        ServiceOffering orphan = services.save(aService().forBusiness(salon.tenant().business())
                .withName("Nobody does this").build());
        mockMvc.perform(bookRequest(salon.slug(), orphan.getId(), NINE_AM, null,
                        "alex@example.test"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("STAFF_NOT_ASSIGNED"));
    }

    @Test
    @DisplayName("the policy window is two opposite refusals, each carrying the boundary it crossed")
    void policyRefusals() throws Exception {
        Salon salon = aSalon();
        BookingPolicy policy = policies.findById(salon.businessId()).orElseThrow();
        policy.setMinLeadTimeHours(4);
        policy.setMaxAdvanceDays(7);
        policies.save(policy);

        // TestTime.NOW is Monday 09:00Z, so four hours of notice puts the floor at 13:00Z.
        book(salon, Instant.parse("2026-03-02T11:00:00Z"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("POLICY_LEAD_TIME"))
                .andExpect(jsonPath("$.earliestStart").value("2026-03-02T13:00:00Z"));

        book(salon, parisTime("2026-03-25T10:00"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("POLICY_MAX_ADVANCE"))
                .andExpect(jsonPath("$.latestStart").value("2026-03-09T09:00:00Z"));
    }

    @Test
    @DisplayName("a start off the grid and a start nobody works are two different 422s")
    void slotRefusals() throws Exception {
        Salon salon = aSalon();

        // 09:17 is inside the working day and is not a half-hour step from the start of it.
        book(salon, parisTime("2026-03-04T09:17"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SLOT_NOT_ON_GRID"))
                .andExpect(jsonPath("$.slotGranularityMinutes").value(30));

        // 06:00 is on the grid and the salon is shut.
        book(salon, parisTime("2026-03-04T06:00"))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SLOT_OUTSIDE_HOURS"));

        // So is every start on a day the whole business is closed (D5).
        overrides.save(anOverride().forBusiness(salon.businessId()).businessWide()
                .on(WEDNESDAY).wholeDay().blocked().because("Public holiday").build());
        book(salon, NINE_AM)
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("SLOT_OUTSIDE_HOURS"));
    }

    @Test
    @DisplayName("a booked slot is 409 and not 422, because refetching is what the client should do")
    void aTakenSlotIsAConflictRatherThanARejection() throws Exception {
        Salon salon = solo(aSalon());

        book(salon, NINE_AM).andExpect(status().isCreated());

        // Refused before the insert, by comparing what the engine offers against what it would
        // offer on an empty calendar — but with the same code and the same body the constraint
        // itself produces, because to a client the two are the same event.
        book(salon, NINE_AM, salon.dana().getId(), "someone-else@example.test")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("BOOKING_SLOT_TAKEN"))
                // Here the client did name a person, so the person is echoed back with the slot.
                .andExpect(jsonPath("$.staffId").value(salon.dana().getId().toString()));
    }

    @Test
    @DisplayName("an unknown business slug is 404, and a malformed body is a 422 naming the field")
    void requestRefusals() throws Exception {
        Salon salon = aSalon();

        mockMvc.perform(bookRequest("no-such-shop", salon.serviceId(), NINE_AM, null,
                        "alex@example.test"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("NOT_FOUND"));

        book(salon, NINE_AM, null, "not-an-email")
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.errors[0].field").value("guestEmail"));
    }

    // ---------------------------------------------------------------------------------
    //  what the row carries
    // ---------------------------------------------------------------------------------

    @Test
    @DisplayName("D14: the row snapshots its price and buffers, and D4: it stores its own block")
    void theRowSnapshotsItsTerms() throws Exception {
        Salon salon = solo(aSalonWithBuffers(15, 15));
        // Not 09:00: with fifteen minutes of setup, the first appointment of a 09:00 day starts at
        // 09:30, because setting up at 08:45 means opening at 08:45.
        Instant halfPastNine = parisTime("2026-03-04T09:30");

        book(salon, halfPastNine).andExpect(status().isCreated());

        Booking booking = bookings.findActiveForStaffBetween(List.of(salon.dana().getId()),
                halfPastNine, halfPastNine.plusSeconds(1)).getFirst();
        assertThat(booking.getPriceCents()).isEqualTo(5_000L);
        assertThat(booking.getBufferBeforeMinutes()).isEqualTo(15);
        assertThat(booking.getBufferAfterMinutes()).isEqualTo(15);
        assertThat(booking.getEndsAt()).isEqualTo(halfPastNine.plus(60, ChronoUnit.MINUTES));
        assertThat(booking.getBlockedFrom()).isEqualTo(halfPastNine.minus(15, ChronoUnit.MINUTES));
        assertThat(booking.getBlockedTo()).isEqualTo(halfPastNine.plus(75, ChronoUnit.MINUTES));
        assertThat(booking.getGuestPhone()).isEqualTo("+33 1 23 45 67 89");
        assertThat(booking.getNotes()).isEqualTo("Second chair by the window, please");
        assertThat(booking.getDepositPaidCents()).isZero();
    }

    @Test
    @DisplayName("an any-staff booking goes to the person with the lighter day, then the lower id")
    void theAnyStaffTieBreakSpreadsTheWork() throws Exception {
        Salon salon = aSalon();
        UUID dana = salon.dana().getId();
        UUID sam = salon.sam().getId();
        UUID lower = dana.compareTo(sam) < 0 ? dana : sam;
        UUID higher = lower.equals(dana) ? sam : dana;

        // Both are free all day, so the first booking is decided by the id alone — deterministic,
        // which is the property that matters and one a "take the first candidate" rule would also
        // have. The difference only shows up on the second booking.
        assertThat(bookOk(salon, parisTime("2026-03-04T09:00")).staffId()).isEqualTo(lower);

        // Now one of them has a booking that day and the other does not, so a start they can both
        // serve goes to the quieter one. Without the tie-break this would be the same person twice,
        // and one stylist would take every appointment in the shop.
        assertThat(bookOk(salon, parisTime("2026-03-04T14:00")).staffId()).isEqualTo(higher);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private PublicBookingResponse asBooking(String body) {
        try {
            return json.readValue(body, PublicBookingResponse.class);
        } catch (Exception e) {
            throw new AssertionError("not a booking response: " + body, e);
        }
    }

    private List<Instant> startsOn(Salon salon) throws Exception {
        String body = mockMvc.perform(availabilityRequest(salon, WEDNESDAY))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return json.readValue(body, new TypeReference<List<SlotResponse>>() {
        }).stream().map(SlotResponse::start).toList();
    }
}
