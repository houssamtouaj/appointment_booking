package com.slotflow.catalog;

import com.slotflow.common.web.PageResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The catalog, from inside the tenant. {@code /api/services} keeps the word the brief uses; the
 * Java type behind it is {@link ServiceOffering} (D8).
 *
 * <p>Reads are open to the whole team — a staff member needs to know what they are performing and
 * for how long — and every write is {@code OWNER}. That split is an annotation next to each method
 * rather than a URL pattern in the filter chain, so a new endpoint cannot inherit the wrong rule by
 * being added to the wrong list.
 */
@RestController
@RequestMapping("/api/services")
@Tag(name = "Catalog", description = "What a business sells, and who performs it")
public class CatalogController {

    private final CatalogAdminService catalog;

    public CatalogController(CatalogAdminService catalog) {
        this.catalog = catalog;
    }

    @GetMapping
    @Operation(summary = "List services",
            description = "Paginated and scoped to the caller's business. Omit ?active= for "
                    + "everything, or pass true/false to separate the live catalog from the "
                    + "archive. Ordered by name; ?sort= is not honoured.")
    public PageResponse<ServiceResponse> list(
            @RequestParam(required = false) Boolean active,
            Pageable pageable) {
        return catalog.list(active, pageable);
    }

    /**
     * One service. A read, so another tenant's id comes back as {@code 404} — never {@code 403},
     * which would confirm that the id exists somewhere.
     */
    @GetMapping("/{id}")
    @Operation(summary = "One service")
    public ServiceResponse get(@PathVariable UUID id) {
        return catalog.get(id);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Create a service",
            description = "staffIds assigns who performs it. Leaving it out is legal and returns "
                    + "bookable: false, because a service nobody performs produces no slots.")
    public ServiceResponse create(@Valid @RequestBody ServiceRequest request) {
        return catalog.create(request);
    }

    /**
     * Partial: an absent field is left alone. {@code staffIds} replaces the whole assignment set
     * when present, and {@code []} unassigns everybody — see {@link ServiceUpdateRequest}.
     */
    @PatchMapping("/{id}")
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Update a service",
            description = "Absent fields are left alone. staffIds replaces the assignment set; "
                    + "an empty array unassigns everyone. Editing a price or a buffer never "
                    + "changes a booking that already exists (D14).")
    public ServiceResponse update(@PathVariable UUID id,
                                  @Valid @RequestBody ServiceUpdateRequest request) {
        return catalog.update(id, request);
    }

    /**
     * A soft delete, and the response says so: {@code active} comes back false and the record is
     * still readable. Bookings that name the service are untouched.
     */
    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('OWNER')")
    @Operation(summary = "Deactivate a service",
            description = "A soft delete: the service leaves the public list immediately, its "
                    + "bookings stay readable, and PATCH with active: true brings it back.")
    public ServiceResponse deactivate(@PathVariable UUID id) {
        return catalog.deactivate(id);
    }
}
