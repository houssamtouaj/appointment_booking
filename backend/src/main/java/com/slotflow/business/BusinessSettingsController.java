package com.slotflow.business;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * The two settings resources a tenant edits about itself: the business and its booking policy.
 *
 * <p>Neither path carries an id, which is the whole reason they are safe: the business under edit is
 * the one in the access token, so there is nothing for a caller to substitute. What remains is a role
 * question — everybody may read the settings, only an owner may change them — and that one an
 * annotation can express, so both writes carry {@code @PreAuthorize} and neither service needs a
 * tenant guard.
 *
 * <p>Reads are open to staff on purpose. A staff member's own calendar is drawn in the business
 * timezone and their bookings are governed by the policy's cutoff, so hiding the numbers would leave
 * them unable to explain their own screen.
 */
@RestController
@Tag(name = "Business settings", description = "The tenant's own name, timezone, currency and policy")
public class BusinessSettingsController {

    private final BusinessSettingsService settings;
    private final PolicyService policy;

    public BusinessSettingsController(BusinessSettingsService settings, PolicyService policy) {
        this.settings = settings;
        this.policy = policy;
    }

    @GetMapping("/api/business")
    @Operation(summary = "Read the business settings",
            description = "Name, timezone, currency, deposit rule, and the immutable public slug.")
    public BusinessResponse business() {
        return settings.get();
    }

    /**
     * A timezone change needs {@code confirmShift: true}, and the first attempt without it answers
     * {@code 409 TIMEZONE_SHIFT_UNCONFIRMED} with the number of future bookings involved.
     */
    @PutMapping("/api/business")
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Update the business settings",
            description = "The slug cannot change. Changing the timezone shifts every future slot, "
                    + "so it requires confirmShift: true; without it the response is 409 "
                    + "TIMEZONE_SHIFT_UNCONFIRMED carrying affectedBookings.")
    public BusinessResponse updateBusiness(@Valid @RequestBody BusinessRequest request) {
        return settings.update(request);
    }

    @GetMapping("/api/policy")
    @Operation(summary = "Read the booking policy")
    public PolicyResponse policy() {
        return policy.get();
    }

    @PutMapping("/api/policy")
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Replace the booking policy",
            description = "slotGranularityMinutes must be one of 5, 10, 15, 20, 30 or 60 — it "
                    + "governs slot starts, and is deliberately not validated against service "
                    + "durations.")
    public PolicyResponse updatePolicy(@Valid @RequestBody PolicyRequest request) {
        return policy.replace(request);
    }
}
