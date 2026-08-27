package com.slotflow.availability;

import com.slotflow.common.error.ApiException;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import com.slotflow.tenant.TenantContext;
import jakarta.persistence.EntityNotFoundException;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One-off changes to availability: a holiday, an afternoon off, a Saturday opening, a closure.
 *
 * <h2>Two levels, one table</h2>
 * A staff-level row names a person; a business-wide row leaves {@code staff_id} null and applies to
 * everybody in the tenant, now and as people join (D5). The merged read therefore needs no union: a
 * business id is on every row, so one query returns both levels, and a closure appears once with
 * {@code businessWide: true} rather than fanned out into a copy per staff member — copies would need
 * ids, and ids that can be deleted individually are a closure that can be half-removed.
 *
 * <h2>What is deliberately not validated</h2>
 * Overlapping overrides on the same date are allowed, including a {@code BLOCKED} and an
 * {@code EXTRA} covering the same hour. The engine resolves precedence (plan 09, where
 * {@code BLOCKED} always wins), and a configuration API that refused every combination it could not
 * itself interpret would refuse the ordinary case of a business-wide closure with one person's extra
 * hours layered on it.
 */
@Service
public class OverrideService {

    private static final Logger log = LoggerFactory.getLogger(OverrideService.class);

    /**
     * The order the admin calendar draws: by date, closures affecting everybody first, then by time
     * of day. Stable, so a refresh does not shuffle a list somebody is clicking in.
     */
    private static final Comparator<AvailabilityOverride> CALENDAR_ORDER = Comparator.comparing(
            AvailabilityOverride::getDate)
            .thenComparing(AvailabilityOverride::isBusinessWide,
                    Comparator.reverseOrder())
            .thenComparing(AvailabilityOverride::getStartTime,
                    Comparator.nullsFirst(Comparator.naturalOrder()))
            .thenComparing(AvailabilityOverride::getId);

    private final AvailabilityOverrideRepository overrides;
    private final UserRepository users;
    private final AvailabilityMapper mapper;
    private final TenantContext tenant;

    public OverrideService(AvailabilityOverrideRepository overrides, UserRepository users,
            AvailabilityMapper mapper, TenantContext tenant) {
        this.overrides = overrides;
        this.users = users;
        this.mapper = mapper;
        this.tenant = tenant;
    }

    // ---------------------------------------------------------------------------------
    //  the merged view
    // ---------------------------------------------------------------------------------

    /**
     * Everything in the tenant between two dates, both levels together.
     *
     * <p>Open to staff as well as owners. A staff member has to be able to see the business-wide
     * closure that is about to cancel their Tuesday, and their colleagues' days off are already
     * visible to them in the shared calendar this list feeds.
     *
     * <p>No cap on the range, and that is a considered omission rather than an oversight: unlike
     * bookings, overrides are one row per holiday per person and do not grow with traffic, so
     * clamping the span would add a rule a client has to discover in exchange for nothing.
     */
    @Transactional(readOnly = true)
    public List<OverrideResponse> between(LocalDate from, LocalDate to) {
        if (to.isBefore(from)) {
            throw ApiException.invalidField("to", "must not be before from");
        }
        return overrides.findByBusinessIdAndDateBetween(tenant.businessId(), from, to).stream()
                .sorted(CALENDAR_ORDER)
                .map(mapper::toResponse)
                .toList();
    }

    // ---------------------------------------------------------------------------------
    //  staff-level
    // ---------------------------------------------------------------------------------

    /**
     * One person's own override. An owner creates it for anybody in the tenant; a staff member only
     * for themselves, which is the same rule as their working hours and the same call that enforces
     * it.
     */
    @Transactional
    public OverrideResponse createFor(UUID staffId, OverrideRequest request) {
        tenant.requireOwnerOrSelf(staffId);
        User staff = loadStaffForWrite(staffId);
        requireCoherentTimes(request);

        AvailabilityOverride override = switch (request.type()) {
        case BLOCKED -> request.isWholeDay()
                ? AvailabilityOverride.blockedDay(
                        staff.getBusinessId(), staffId, request.date(), request.reason())
                : AvailabilityOverride.blockedRange(
                        staff.getBusinessId(), staffId, request.date(),
                        request.startTime(), request.endTime(), request.reason());
        case EXTRA -> AvailabilityOverride.extraHours(
                staff.getBusinessId(), staffId, request.date(),
                request.startTime(), request.endTime(), request.reason());
        };
        return mapper.toResponse(overrides.save(override));
    }

    /**
     * Deletes one of that person's overrides.
     *
     * <p>The staff id in the path is checked against the row rather than trusted: without it, a staff
     * member could delete a colleague's day off through their own path, and the authorisation check
     * above would have passed. A business-wide row is not reachable here either — it belongs to
     * nobody, and removing it is an owner's decision through {@code /api/exceptions}.
     */
    @Transactional
    public void deleteFor(UUID staffId, UUID overrideId) {
        tenant.requireOwnerOrSelf(staffId);
        loadStaffForWrite(staffId);

        AvailabilityOverride override = loadForWrite(overrideId);
        if (!staffId.equals(override.getStaffId())) {
            throw new EntityNotFoundException(
                    "override " + overrideId + " does not belong to staff member " + staffId);
        }
        overrides.delete(override);
    }

    // ---------------------------------------------------------------------------------
    //  business-wide (D5)
    // ---------------------------------------------------------------------------------

    /**
     * A closure that applies to everybody, which is why it is owner-only.
     *
     * <p><b>{@code BLOCKED} only.</b> A business can declare itself shut on behalf of its staff — that
     * is what a public holiday is — but it cannot declare them available: only the person working an
     * evening knows whether they can, and a business-wide {@code EXTRA} would put everyone on the
     * booking page for hours nobody agreed to. So the {@code EXTRA} direction stays per-person, and
     * asking for it here is a 422 that says so rather than a row the engine would have to interpret.
     */
    @Transactional
    public OverrideResponse createBusinessWide(OverrideRequest request) {
        requireCoherentTimes(request);
        if (request.type() == OverrideType.EXTRA) {
            throw ApiException.invalidField("type",
                    "a business-wide override can only be BLOCKED; add extra hours per staff member");
        }

        AvailabilityOverride closure = request.isWholeDay()
                ? AvailabilityOverride.businessWideClosure(
                        tenant.businessId(), request.date(), request.reason())
                : AvailabilityOverride.businessWideClosure(
                        tenant.businessId(), request.date(),
                        request.startTime(), request.endTime(), request.reason());
        log.info("Business {} closed on {}{}", tenant.businessId(), request.date(),
                request.isWholeDay() ? "" : " from " + request.startTime() + " to " + request.endTime());
        return mapper.toResponse(overrides.save(closure));
    }

    /**
     * Deletes any override in the tenant, whichever level it belongs to.
     *
     * <p>Owner-only, and broader than its sibling on purpose: this is the delete button on the merged
     * calendar, where an owner sees closures and individuals' days off side by side and should not
     * need a different endpoint depending on which row they clicked.
     */
    @Transactional
    public void delete(UUID overrideId) {
        overrides.delete(loadForWrite(overrideId));
    }

    // ---------------------------------------------------------------------------------
    //  validation and helpers
    // ---------------------------------------------------------------------------------

    /**
     * The three shapes of times the entity would otherwise refuse with an
     * {@code IllegalArgumentException}, which on a form submission is a 500.
     *
     * <p>The {@code EXTRA} case is the one plan 08 calls out: a whole-day {@code EXTRA} is not a
     * generous rule, it is a sentence with no meaning — "available, from no time until no time" — and
     * the schema refuses it as well.
     */
    private static void requireCoherentTimes(OverrideRequest request) {
        if ((request.startTime() == null) != (request.endTime() == null)) {
            throw ApiException.invalidField(
                    request.startTime() == null ? "startTime" : "endTime",
                    "startTime and endTime must both be set, or both be omitted for a whole day");
        }
        if (request.startTime() != null && request.startTime().equals(request.endTime())) {
            throw ApiException.invalidField("endTime", "must differ from startTime");
        }
        if (request.isWholeDay() && request.type() == OverrideType.EXTRA) {
            throw ApiException.invalidField("startTime",
                    "an EXTRA override must name a start and an end time");
        }
    }

    private User loadStaffForWrite(UUID staffId) {
        User staff = users.findById(staffId)
                .orElseThrow(() -> new EntityNotFoundException("staff member " + staffId));
        return tenant.requireOwnedForWrite(staff);
    }

    /** A write path: load by id, then guard, so a foreign id is refused rather than hidden. */
    private AvailabilityOverride loadForWrite(UUID overrideId) {
        AvailabilityOverride override = overrides.findById(overrideId)
                .orElseThrow(() -> new EntityNotFoundException("override " + overrideId));
        return tenant.requireOwnedForWrite(override);
    }
}
