package com.slotflow.booking;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Step 4 of the booking flow, and the only unauthenticated endpoint in this API that creates a row.
 *
 * <h2>The token is the whole authentication story</h2>
 * There is no customer account (D1). {@code cancellationToken} is a random UUID, unique, never
 * reissued, and it is the entire credential for viewing or cancelling a booking. That is why the
 * manage endpoints key off it directly rather than taking a booking id and a token to match: an id
 * in the path plus a secret in a header is two things to leak instead of one, and the id would be
 * enumerable.
 *
 * <h2>Rate limited twice, at two different granularities</h2>
 * {@code RateLimitFilter} applies the per-IP {@code PUBLIC_WRITE} budget to everything under
 * {@code /api/public/**}, before Spring Security and before this class exists. The per-email budget
 * (D12) is enforced inside {@link PublicBookingService}, because the address only exists once the
 * body has been parsed. One machine hammering the endpoint and one address hoarding slots across a
 * botnet are different attacks and neither limit catches the other.
 */
@RestController
@Tag(name = "Public booking", description = "Unauthenticated endpoints the booking page calls")
@SecurityRequirements
public class PublicBookingController {

    private final PublicBookingService bookings;

    public PublicBookingController(PublicBookingService bookings) {
        this.bookings = bookings;
    }

    @PostMapping("/api/public/businesses/{slug}/bookings")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Book a slot",
            description = """
                    Turns a start time from the availability response into a booking. startsAt \
                    must be copied verbatim from a slot; omit staffId to let the business pick the \
                    person with the lightest day.

                    The response carries the cancellation token, which is the customer's only \
                    credential — put it in the manage link and in the confirmation email, because \
                    it is never reissued.

                    409 BOOKING_SLOT_TAKEN means somebody else got there first, and the body \
                    echoes the slot so the client can grey it out and refetch. It is produced by a \
                    database exclusion constraint, not by a check, so it is correct even when two \
                    requests arrive in the same millisecond. A 422 means the start was never on \
                    offer, and refetching will not change that.""")
    public PublicBookingResponse book(@PathVariable String slug,
                                      @Valid @RequestBody BookingRequest request) {
        return bookings.create(slug, request);
    }

    @GetMapping("/api/public/bookings/{cancellationToken}")
    @Operation(summary = "My booking",
            description = "Everything behind the manage link. depositRefundable is always false "
                    + "(D7) and the page must render that in words next to the cancel button, "
                    + "before the click.")
    public PublicBookingResponse byToken(
            @Parameter(description = "From the confirmation email; the customer's only credential")
            @PathVariable UUID cancellationToken) {
        return bookings.byToken(cancellationToken);
    }
}
