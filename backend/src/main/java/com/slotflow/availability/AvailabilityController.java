package com.slotflow.availability;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Step 3 of the booking flow, and the endpoint the calendar polls: "when can I come in?"
 *
 * <p>Anonymous and read-only. Nothing is written here and nothing is held — a slot in this response
 * is an offer, not a reservation, and two customers can be looking at the same 10:00. Which of them
 * gets it is decided by the exclusion constraint when one of them books (plan 10), because a
 * check-then-insert across two requests has a race in it that no amount of reading can close.
 *
 * <p>Public reads are deliberately outside the rate limiter (D12): this is the endpoint a calendar
 * re-fetches every time somebody clicks to the next week, and throttling it would throttle the
 * product rather than an abuser.
 */
@RestController
@Tag(name = "Public booking", description = "Unauthenticated endpoints the booking page calls")
@SecurityRequirements
public class AvailabilityController {

    private final AvailabilityService availability;

    public AvailabilityController(AvailabilityService availability) {
        this.availability = availability;
    }

    @GetMapping("/api/public/businesses/{slug}/availability")
    @Operation(summary = "When can I come in",
            description = """
                    The bookable start times for a service between two dates, ascending. Every \
                    instant is UTC; tz decides only where the requested days begin and end, never \
                    how working hours are read — those are always in the business's own timezone.

                    Each slot carries every staff member who could serve it. Omit staffId to ask \
                    "anybody"; the answer is the union across everyone who performs the service, \
                    deduped by start time.

                    A slot is an offer and not a hold. Nothing here is written, and two customers \
                    may be looking at the same one.""")
    public List<SlotResponse> availability(
            @PathVariable String slug,

            @Parameter(description = "The service being booked; sets the duration and the buffers")
            @RequestParam UUID serviceId,

            @Parameter(description = "First day, inclusive", example = "2026-03-02")
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,

            @Parameter(description = "Last day, inclusive. At most 62 days after from",
                    example = "2026-03-08")
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to,

            @Parameter(description = "IANA zone deciding where from and to begin and end. "
                    + "Defaults to the business's timezone", example = "Europe/Paris")
            @RequestParam(required = false) String tz,

            @Parameter(description = "Narrow to one staff member. Omit for any")
            @RequestParam(required = false) UUID staffId) {
        return availability.slots(slug, serviceId, from, to, tz, staffId);
    }
}
