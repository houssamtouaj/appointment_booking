package com.slotflow.staff;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * D9, step 2 of the booking flow: "pick a staff member, or anyone".
 *
 * <p>The response is {@link PublicStaffResponse} — an id and a display name. No email address, no
 * role, no active flag, and {@code PublicStaffEndpointIT} asserts that on the raw JSON rather than
 * on a deserialised object, because a leak here would be a leak of a field a test that maps back to
 * a DTO would never see.
 */
@RestController
@Tag(name = "Public booking", description = "Unauthenticated endpoints the booking page calls")
@SecurityRequirements
public class PublicStaffController {

    private final PublicStaffService publicStaff;

    public PublicStaffController(PublicStaffService publicStaff) {
        this.publicStaff = publicStaff;
    }

    @GetMapping("/api/public/businesses/{slug}/staff")
    @Operation(summary = "Who can be booked",
            description = "Active staff for a business, optionally narrowed to those who perform "
                    + "one service. Returns id and display name only.")
    public List<PublicStaffResponse> staff(
            @PathVariable String slug,
            @RequestParam(required = false) UUID serviceId) {
        return publicStaff.bookableStaff(slug, serviceId);
    }
}
