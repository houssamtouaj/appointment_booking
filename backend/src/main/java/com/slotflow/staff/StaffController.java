package com.slotflow.staff;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The team, from inside the tenant. Every path here is authenticated, and every one of them is
 * scoped to the business in the token rather than to anything in the URL.
 *
 * <p>Authorisation is split between two mechanisms, deliberately:
 *
 * <ul>
 *   <li>{@code @PreAuthorize("hasRole('OWNER')")} for the operations only an owner may perform at
 *       all. A declarative rule next to the method cannot drift away from the endpoint it
 *       guards.</li>
 *   <li>{@link com.slotflow.tenant.TenantContext} inside the service for the rules that depend on
 *       the target row — "an owner, or a staff member acting on themselves", and the tenant check
 *       itself. No annotation can express those, and pretending otherwise produces a rule that is
 *       almost right.</li>
 * </ul>
 */
@RestController
@RequestMapping("/api/staff")
@Tag(name = "Staff", description = "The team inside a business")
public class StaffController {

    private final StaffAdminService staff;

    public StaffController(StaffAdminService staff) {
        this.staff = staff;
    }

    @GetMapping
    @Operation(summary = "List the team",
            description = "Everyone in the caller's business, active or not, with their "
                    + "service assignments. Owners and staff alike.")
    public List<StaffResponse> list() {
        return staff.list();
    }

    /**
     * One colleague. A read, so another tenant's id comes back as {@code 404} — never {@code 403},
     * which would confirm that the id exists somewhere.
     */
    @GetMapping("/{id}")
    @Operation(summary = "One colleague")
    public StaffResponse get(@PathVariable UUID id) {
        return staff.get(id);
    }

    @PostMapping("/invite")
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Invite a colleague",
            description = "Creates an inactive user with no password and emails a single-use link "
                    + "that lasts seven days. An address that already has an account anywhere is "
                    + "409 EMAIL_TAKEN (D13).")
    public StaffResponse invite(@Valid @RequestBody InviteStaffRequest request) {
        return staff.invite(request);
    }

    @PostMapping("/{id}/invite/resend")
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Send a fresh invitation",
            description = "Invalidates the outstanding links and issues a new one, so a forgotten "
                    + "invitation cannot accumulate live keys to the account.")
    public StaffResponse resend(@PathVariable UUID id) {
        return staff.resendInvitation(id);
    }

    /**
     * An owner may change a name, a role and the active flag; a staff member may change their own
     * name. Deactivating the last active owner is {@code 409 LAST_OWNER}, and deactivating anyone
     * with future bookings returns a warning alongside the updated record rather than touching
     * those bookings.
     */
    @PatchMapping("/{id}")
    @Operation(summary = "Update a colleague",
            description = "Owner: name, role, active. Staff: their own name only. The last active "
                    + "owner cannot be deactivated or demoted (409 LAST_OWNER).")
    public StaffUpdateResponse update(@PathVariable UUID id,
            @Valid @RequestBody UpdateStaffRequest request) {
        return staff.update(id, request);
    }
}
