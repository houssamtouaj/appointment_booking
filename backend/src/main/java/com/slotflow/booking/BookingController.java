package com.slotflow.booking;

import com.slotflow.common.web.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The calendar from inside the business.
 *
 * <p>Every endpoint here is open to {@code OWNER} and {@code STAFF} alike, and there is no
 * {@code @PreAuthorize} on any of them — which is a decision rather than an omission. A staff member
 * has to see their own day and mark their own appointments completed, and the interesting question
 * is not their role but their tenant, which {@code TenantContext} answers on every call. The one
 * rule a role could express — "staff may only see their own bookings" — is deliberately not the
 * product: a receptionist books for the whole salon.
 *
 * <p>There is no {@code POST} here. Bookings are created through the public endpoint, by a customer,
 * with a slot they picked; a business creating one on a customer's behalf would need its own
 * override semantics for the policy window and the cutoff, and that is not in v1.
 */
@RestController
@RequestMapping("/api/bookings")
@Tag(name = "Bookings", description = "The calendar, from inside the business")
public class BookingController {

    private final BookingAdminService bookings;

    public BookingController(BookingAdminService bookings) {
        this.bookings = bookings;
    }

    @GetMapping
    @Operation(summary = "List bookings",
            description = """
                    Paginated and scoped to the caller's business. Every filter is optional and \
                    they combine; from is inclusive and to is exclusive, so two adjacent day \
                    queries neither overlap nor leave a gap. Ordered by start time; ?sort= is not \
                    honoured.

                    Rows carry the guest's name but not their email or phone — those are on the \
                    detail view.""")
    public PageResponse<BookingSummaryResponse> list(

            @Parameter(description = "Earliest start, inclusive", example = "2026-03-02T00:00:00Z")
            @RequestParam(required = false) Instant from,

            @Parameter(description = "Latest start, exclusive", example = "2026-03-09T00:00:00Z")
            @RequestParam(required = false) Instant to,

            @RequestParam(required = false) BookingStatus status,

            @Parameter(description = "Narrow to one staff member. A foreign id matches nothing.")
            @RequestParam(required = false) UUID staffId,

            Pageable pageable) {
        return bookings.list(from, to, status, staffId, pageable);
    }

    /**
     * The only response in the API carrying a guest's email address and phone number. A read, so
     * another tenant's id comes back as {@code 404} rather than {@code 403} — which would confirm
     * that the booking exists somewhere.
     */
    @GetMapping("/{id}")
    @Operation(summary = "One booking",
            description = "Full detail, including the guest contact details and the blocked "
                    + "window the appointment actually costs the calendar (D4). The price and the "
                    + "buffers are the snapshot taken when the booking was made, not today's "
                    + "service configuration (D14).")
    public BookingResponse get(@PathVariable UUID id) {
        return bookings.get(id);
    }

    @PatchMapping("/{id}/status")
    @Operation(summary = "Move a booking through its lifecycle",
            description = """
                    CANCELLED, COMPLETED or NO_SHOW. Anything outside the transition matrix is \
                    409 ILLEGAL_TRANSITION naming both states, including CONFIRMED: a deposit \
                    confirms a booking, staff do not (D2).

                    Two of the moves are time-guarded. COMPLETED needs the appointment to have \
                    finished and NO_SHOW needs it to have started, because a completed \
                    appointment in the future is a data-quality bug that resurfaces as a wrong \
                    number on the dashboard.

                    Staff cancelling ignores the customer cancellation cutoff — a business can \
                    always cancel — and frees the slot immediately.""")
    public BookingResponse transition(@PathVariable UUID id,
                                      @Valid @RequestBody BookingStatusRequest request) {
        return bookings.transition(id, request.status());
    }
}
