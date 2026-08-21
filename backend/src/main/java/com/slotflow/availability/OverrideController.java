package com.slotflow.availability;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Holidays, days off, extra hours and closures — {@code exceptions} on the wire,
 * {@link AvailabilityOverride} in the code (D8), because a domain class called
 * {@code AvailabilityException} is a class somebody will eventually try to catch.
 *
 * <p>Two path families, and the split is the authorisation model rather than a naming choice:
 *
 * <ul>
 *   <li>{@code /api/staff/{staffId}/exceptions} — one person's own. An owner may write anybody's, a
 *       staff member only their own, which is a rule about the id in the path and therefore lives in
 *       {@link OverrideService}.</li>
 *   <li>{@code /api/exceptions} — the tenant's. The {@code GET} is the merged calendar both levels
 *       appear in; the {@code POST} creates a closure that applies to everybody (D5) and is
 *       {@code OWNER} by annotation, because that rule needs nothing from the request to decide.</li>
 * </ul>
 */
@RestController
@Tag(name = "Availability configuration",
        description = "Working hours, one-off overrides, and the policy the engine reads")
public class OverrideController {

    private final OverrideService overrides;

    public OverrideController(OverrideService overrides) {
        this.overrides = overrides;
    }

    // ---------------------------------------------------------------------------------
    //  the merged calendar
    // ---------------------------------------------------------------------------------

    @GetMapping("/api/exceptions")
    @Operation(summary = "Every override in a date range",
            description = "Business-wide closures and every staff member's own, in one list. A "
                    + "closure appears once, with businessWide: true, and applies to everybody. "
                    + "Owners and staff alike.")
    public List<OverrideResponse> list(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        return overrides.between(from, to);
    }

    // ---------------------------------------------------------------------------------
    //  one staff member's own
    // ---------------------------------------------------------------------------------

    @PostMapping("/api/staff/{staffId}/exceptions")
    @ResponseStatus(HttpStatus.CREATED)
    @Operation(summary = "Block or add hours for one staff member",
            description = "BLOCKED with no times is a whole day off; with times it is part of one. "
                    + "EXTRA adds hours outside the weekly template and must name a range — a "
                    + "whole-day EXTRA has no meaning and is 422. Owners write anyone's, staff "
                    + "their own.")
    public OverrideResponse create(@PathVariable UUID staffId,
                                   @Valid @RequestBody OverrideRequest request) {
        return overrides.createFor(staffId, request);
    }

    @DeleteMapping("/api/staff/{staffId}/exceptions/{exceptionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @Operation(summary = "Remove one staff member's override",
            description = "The override must belong to that staff member: a business-wide closure "
                    + "is not removable through somebody's own path.")
    public void delete(@PathVariable UUID staffId, @PathVariable UUID exceptionId) {
        overrides.deleteFor(staffId, exceptionId);
    }

    // ---------------------------------------------------------------------------------
    //  business-wide (D5)
    // ---------------------------------------------------------------------------------

    @PostMapping("/api/exceptions")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Close the whole business",
            description = "One row with staff_id NULL, applying to every staff member now and to "
                    + "whoever joins later (D5). BLOCKED only: a business cannot declare its staff "
                    + "available on their behalf.")
    public OverrideResponse createBusinessWide(@Valid @RequestBody OverrideRequest request) {
        return overrides.createBusinessWide(request);
    }

    @DeleteMapping("/api/exceptions/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Remove any override",
            description = "The delete button on the merged calendar: an owner may remove a closure "
                    + "or an individual's day off through the same path.")
    public void delete(@PathVariable UUID id) {
        overrides.delete(id);
    }
}
