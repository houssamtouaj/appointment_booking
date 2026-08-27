package com.slotflow.availability;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The weekly template, under the staff member it belongs to.
 *
 * <p>No {@code @PreAuthorize} on either method, and that is deliberate rather than an omission: the
 * rule is "an owner, or a staff member acting on themselves", which no annotation can express
 * because it depends on the id in the path. {@link WorkingHoursService} makes the check through
 * {@code TenantContext}, the same way the staff patch does, and the tests assert both branches.
 */
@RestController
@RequestMapping("/api/staff/{staffId}/working-hours")
@Tag(name = "Availability configuration",
        description = "Working hours, one-off overrides, and the policy the engine reads")
public class WorkingHoursController {

    private final WorkingHoursService workingHours;

    public WorkingHoursController(WorkingHoursService workingHours) {
        this.workingHours = workingHours;
    }

    @GetMapping
    @Operation(summary = "Read a weekly template",
            description = "Owners read anyone in their business; a staff member reads their own. "
                    + "Ordered Monday first, then by start time.")
    public WorkingHoursResponse get(@PathVariable UUID staffId) {
        return workingHours.of(staffId);
    }

    /**
     * A full replace of all seven days. A day with no range in the body is a day not worked, and a
     * second identical {@code PUT} changes nothing at all.
     */
    @PutMapping
    @Operation(summary = "Replace a weekly template",
            description = "The whole week, in one transaction. Multiple ranges per day are allowed "
                    + "(split shifts); an end before the start is a night shift and is accepted; "
                    + "ranges that overlap once laid out on the week are 422 HOURS_OVERLAP.")
    public WorkingHoursResponse replace(@PathVariable UUID staffId,
            @Valid @RequestBody WorkingHoursRequest request) {
        return workingHours.replace(staffId, request);
    }
}
