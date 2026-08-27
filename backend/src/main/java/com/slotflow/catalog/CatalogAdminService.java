package com.slotflow.catalog;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.common.web.PageResponse;
import com.slotflow.staff.UserRepository;
import com.slotflow.tenant.TenantContext;
import jakarta.persistence.EntityNotFoundException;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The catalog from inside the tenant: what is bookable, for how long, at what price, by whom.
 *
 * <p>Named {@code CatalogAdminService} for the reason {@code StaffAdminService} is:
 * {@link StaffService} is the assignment row, and a Spring bean sharing that name in the same
 * package is a paragraph of explanation on every import.
 *
 * <p>Scoping follows the rule the whole API follows. Reads take {@code businessId} as a query
 * parameter, so another tenant's row is never loaded and comes back as a 404; writes load by id and
 * then pass through {@link TenantContext#requireOwnedForWrite}, which is the 403.
 */
@Service
public class CatalogAdminService {

    private static final Logger log = LoggerFactory.getLogger(CatalogAdminService.class);

    /**
     * The admin grid has one useful order, and {@code ?sort=} is deliberately not honoured. A page
     * of an unsorted query is whatever order Postgres found the rows in, which means page 2 can
     * repeat a row from page 1 and omit another entirely. The id tiebreak is there because two
     * services may legitimately share a name.
     */
    private static final Sort BY_NAME = Sort.by(Sort.Order.asc("name"), Sort.Order.asc("id"));

    private final ServiceOfferingRepository services;
    private final StaffServiceRepository assignments;
    private final UserRepository users;
    private final CatalogMapper mapper;
    private final TenantContext tenant;

    public CatalogAdminService(ServiceOfferingRepository services,
            StaffServiceRepository assignments, UserRepository users,
            CatalogMapper mapper, TenantContext tenant) {
        this.services = services;
        this.assignments = assignments;
        this.users = users;
        this.mapper = mapper;
        this.tenant = tenant;
    }

    // ---------------------------------------------------------------------------------
    //  reads
    // ---------------------------------------------------------------------------------

    /**
     * One page of the catalog, with every service's assignment set.
     *
     * <p>Three queries whatever the page size — the services, the assignments of all of them, the
     * tenant's active staff — rather than two per row. It is the same shape as the staff list and
     * for the same reason: this is the pattern later list endpoints copy, and the copy is where an
     * N+1 stops being small.
     *
     * @param active null for everything, true or false to filter, which is the admin UI's
     *               "show archived" switch
     */
    @Transactional(readOnly = true)
    public PageResponse<ServiceResponse> list(Boolean active, Pageable pageable) {
        Pageable sorted = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), BY_NAME);
        Page<ServiceOffering> page = active == null
                ? services.findByBusinessId(tenant.businessId(), sorted)
                : services.findByBusinessIdAndActive(tenant.businessId(), active, sorted);
        // An empty page still skips the two joins, which would have nothing to join against, but
        // the envelope keeps the totals the query already counted. PageResponse.empty is for the
        // case where no query ran at all; reporting totalPages: 0 for a ?page= past the end tells
        // a paginator the catalog is empty and leaves it no way back to page 0.
        Map<UUID, List<UUID>> performers = page.isEmpty()
                ? Map.of()
                : performersOf(page.getContent().stream().map(ServiceOffering::getId).toList());
        Set<UUID> activeStaff = page.isEmpty() ? Set.of() : activeStaffIds();
        return PageResponse.of(page, service -> toResponse(service, performers, activeStaff));
    }

    /** A read: another tenant's id is reported as absent rather than as forbidden. */
    @Transactional(readOnly = true)
    public ServiceResponse get(UUID serviceId) {
        return toResponse(services.findByIdAndBusinessId(serviceId, tenant.businessId())
                .orElseThrow(() -> new EntityNotFoundException("service " + serviceId)));
    }

    // ---------------------------------------------------------------------------------
    //  writes
    // ---------------------------------------------------------------------------------

    /** Creates the service and its assignment set in one transaction. */
    @Transactional
    public ServiceResponse create(ServiceRequest request) {
        ServiceOffering service = new ServiceOffering(tenant.businessId(), request.name(),
                request.durationMinutes(), request.priceCents());
        service.describe(request.description());
        service.setBuffers(orZero(request.bufferBeforeMinutes()),
                orZero(request.bufferAfterMinutes()));
        services.save(service);

        replaceAssignments(service, request.staffIds() == null ? List.of() : request.staffIds());
        log.info("Created service {} ({} min) in business {}", service.getId(),
                service.getDurationMinutes(), service.getBusinessId());
        return toResponse(service);
    }

    /**
     * A partial update. {@code null} means "leave it alone" for every field; see
     * {@link ServiceUpdateRequest} for what that decides about {@code staffIds}.
     *
     * <p><b>Nothing here reaches an existing booking</b> (D14). A booking snapshots the price and
     * both buffers at creation, so editing them changes what the <em>next</em> customer pays and how
     * much calendar the next appointment costs, and leaves every appointment already taken exactly
     * as it was agreed. {@code CatalogIT.editingAPriceLeavesExistingBookingsAlone} is the test that
     * says so, and it is one line for a decision that would otherwise be an argument.
     */
    @Transactional
    public ServiceResponse update(UUID serviceId, ServiceUpdateRequest request) {
        ServiceOffering service = loadForWrite(serviceId);

        if (request.name() != null) {
            service.rename(request.name());
        }
        if (request.description() != null) {
            service.describe(request.description());
        }
        if (request.durationMinutes() != null) {
            service.setDuration(request.durationMinutes());
        }
        if (request.priceCents() != null) {
            service.setPriceCents(request.priceCents());
        }
        if (request.changesBuffers()) {
            // Set together, because the entity treats them as one decision: a patch naming only one
            // of the pair keeps the other rather than resetting it to zero.
            service.setBuffers(
                    request.bufferBeforeMinutes() != null
                            ? request.bufferBeforeMinutes() : service.getBufferBeforeMinutes(),
                    request.bufferAfterMinutes() != null
                            ? request.bufferAfterMinutes() : service.getBufferAfterMinutes());
        }
        if (Boolean.TRUE.equals(request.active())) {
            service.activate();
        } else if (Boolean.FALSE.equals(request.active())) {
            service.deactivate();
        }
        services.save(service);

        if (request.staffIds() != null) {
            replaceAssignments(service, request.staffIds());
        }
        return toResponse(service);
    }

    /**
     * {@code DELETE /api/services/{id}}: deactivation, never a row removal.
     *
     * <p>The service disappears from the public list immediately and every booking that ever named
     * it stays readable, priced as it was sold. A hard delete is not an option the API withholds out
     * of caution: {@code booking}'s foreign key refuses it (D15), so the choice is between this and
     * a 409 the owner can do nothing about.
     *
     * <p>Answers 200 with the updated service rather than 204, because the caller's next screen is
     * the list it just changed and the flag that changed is on the record.
     */
    @Transactional
    public ServiceResponse deactivate(UUID serviceId) {
        ServiceOffering service = loadForWrite(serviceId);
        service.deactivate();
        services.save(service);
        log.info("Deactivated service {} in business {}", service.getId(), service.getBusinessId());
        return toResponse(service);
    }

    // ---------------------------------------------------------------------------------
    //  the assignment set
    // ---------------------------------------------------------------------------------

    /**
     * Replaces the {@code staff_service} rows for one service.
     *
     * <p>Every id is checked against this tenant's own {@code app_user} rows first, so a stranger's
     * id is a {@code 422 STAFF_NOT_IN_BUSINESS} naming the ids that failed. The check is not what
     * makes the assignment safe — {@code staff_service}'s two composite foreign keys make a
     * cross-tenant row unrepresentable, for psql as much as for this method — it is what turns that
     * guarantee into an answer a form can display instead of a generic conflict.
     *
     * <p>Role is not a filter, because both roles perform services: an owner who cuts hair is the
     * normal case in a two-person salon. Deactivated colleagues stay assignable, which is also
     * deliberate — they produce no availability (which is exactly what {@code bookable} reports),
     * and refusing would mean an owner editing a price loses the assignments of anybody currently
     * switched off.
     *
     * <p>A diff rather than a delete-and-reinsert. The rows carry nothing beyond the pair, so
     * rewriting the unchanged ones is churn for its own sake, and a repeated identical write costs
     * no writes at all.
     */
    private void replaceAssignments(ServiceOffering service, Collection<UUID> requestedStaffIds) {
        Set<UUID> wanted = new LinkedHashSet<>(requestedStaffIds);
        requireAllInBusiness(wanted);

        List<StaffService> existing = assignments.findByServiceId(service.getId());
        Set<UUID> current = existing.stream()
                .map(StaffService::getStaffId)
                .collect(Collectors.toSet());

        assignments.deleteAll(existing.stream()
                .filter(assignment -> !wanted.contains(assignment.getStaffId()))
                .toList());
        assignments.saveAll(wanted.stream()
                .filter(staffId -> !current.contains(staffId))
                .map(staffId -> new StaffService(service.getBusinessId(), staffId, service.getId()))
                .toList());
    }

    private void requireAllInBusiness(Set<UUID> staffIds) {
        if (staffIds.isEmpty()) {
            return;
        }
        Set<UUID> members = Set.copyOf(users.findIdsInBusiness(tenant.businessId(), staffIds));
        List<UUID> strangers = staffIds.stream()
                .filter(staffId -> !members.contains(staffId))
                .toList();
        if (!strangers.isEmpty()) {
            throw new ApiException(ErrorCode.STAFF_NOT_IN_BUSINESS,
                    "Those staff members are not part of this business.")
                    .with("staffIds", strangers);
        }
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    /** A write path: load by id, then guard, so a foreign id is refused rather than hidden. */
    private ServiceOffering loadForWrite(UUID serviceId) {
        ServiceOffering service = services.findById(serviceId)
                .orElseThrow(() -> new EntityNotFoundException("service " + serviceId));
        return tenant.requireOwnedForWrite(service);
    }

    private ServiceResponse toResponse(ServiceOffering service) {
        return toResponse(service, performersOf(List.of(service.getId())), activeStaffIds());
    }

    private ServiceResponse toResponse(ServiceOffering service,
            Map<UUID, List<UUID>> performers,
            Set<UUID> activeStaff) {
        List<UUID> staffIds = performers.getOrDefault(service.getId(), List.of());
        boolean bookable = service.isActive() && staffIds.stream().anyMatch(activeStaff::contains);
        return mapper.toResponse(service, bookable, staffIds);
    }

    private Map<UUID, List<UUID>> performersOf(Collection<UUID> serviceIds) {
        return assignments.findForServices(serviceIds).stream()
                .collect(Collectors.groupingBy(StaffService::getServiceId,
                        Collectors.mapping(StaffService::getStaffId, Collectors.toList())));
    }

    /**
     * Who could actually turn a slot into an appointment. Read once per response rather than per
     * service, and the reason {@code bookable} can tell "nobody assigned" apart from "everybody
     * assigned is switched off" — two configurations that look different on screen and produce the
     * same empty calendar.
     */
    private Set<UUID> activeStaffIds() {
        return Set.copyOf(users.findIdsActiveInBusiness(tenant.businessId()));
    }

    private static int orZero(Integer minutes) {
        return minutes == null ? 0 : minutes;
    }
}
