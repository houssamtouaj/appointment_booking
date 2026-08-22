package com.slotflow.availability;

import com.slotflow.availability.domain.AvailabilityEngine;
import com.slotflow.availability.domain.AvailabilityQuery;
import com.slotflow.availability.domain.AvailabilityQuery.StaffSchedule;
import com.slotflow.availability.domain.Slot;
import com.slotflow.availability.domain.TimeWindow;
import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessFields;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.catalog.StaffServiceRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Loads what the engine needs, calls it, and maps the answer.
 *
 * <h2>Three queries for the whole range, never one per day</h2>
 * The working hours, the overrides and the bookings are each fetched <em>once</em>, for every
 * candidate staff member across the entire requested span, and the fold happens in memory. The naive
 * shape — a loop over the dates asking the same three questions each time — is a thirty-fold N+1 on
 * a month view that no unit test would ever notice and that shows up immediately in a deployed demo.
 *
 * <p>Four more statements resolve what was asked about: the business, the service, the policy, and
 * which staff can perform the service. So the endpoint is seven statements, and — this is the part
 * that matters — it is seven for one day and seven for sixty. {@code AvailabilityQueryCountIT}
 * asserts the number from both ends rather than trusting this paragraph.
 *
 * <h2>Everything time-dependent comes from the injected {@code Clock}</h2>
 * The policy window is computed here and handed to the engine as two instants, which is what keeps
 * the engine a pure function and lets its tests assert on a lead time with no Spring context.
 *
 * <h2>Two callers, one loader</h2>
 * {@link #slots} answers the calendar; {@link #verify} answers the booking path (plan 10) about one
 * exact start. Both go through {@link #load}, which is the point: the booking insert must be
 * checked against precisely the windows the list endpoint offered, and against {@code
 * [blocked_from, blocked_to)} rather than the customer-visible pair (D4). A second loader in the
 * booking package would be a second chance to get that wrong, and the symptom would be a {@code
 * 409} from the exclusion constraint on a slot the API had just advertised.
 */
@Service
public class AvailabilityService {

    /**
     * The widest span one request may ask for.
     *
     * <p>An anonymous endpoint with an unbounded date range is a request for a decade of slots that
     * costs the server a decade of work. Sixty-two days is two calendar months — comfortably more
     * than the sixty-day default booking horizon, and more than any calendar renders at once — so
     * the cap is invisible to the client this is built for and finite for everybody else.
     */
    static final int MAX_RANGE_DAYS = 62;

    /**
     * The calendar this endpoint will answer for at all.
     *
     * <p>{@code from} and {@code to} arrive parsed and otherwise unexamined, and {@code
     * LocalDate.MAX} clears both guards in {@link #requestedRange} — it is not before itself and it
     * is zero days from itself — only to overflow on the {@code plusDays} that turns it into an
     * instant. On an endpoint that is anonymous and deliberately exempt from the rate limiter (D12),
     * that is a 500 and a stack trace for the price of one query string, so the dates are bounded
     * here to something a booking calendar could plausibly mean and refused with the same 422 every
     * other bad range gets.
     */
    static final LocalDate EARLIEST_QUERYABLE_DAY = LocalDate.of(1970, 1, 1);

    static final LocalDate LATEST_QUERYABLE_DAY = LocalDate.of(9999, 12, 31);

    private final BusinessRepository businesses;
    private final ServiceOfferingRepository services;
    private final BookingPolicyRepository policies;
    private final StaffServiceRepository assignments;
    private final WorkingHoursRepository workingHours;
    private final AvailabilityOverrideRepository overrides;
    private final BookingRepository bookings;
    private final Clock clock;

    public AvailabilityService(BusinessRepository businesses, ServiceOfferingRepository services,
                               BookingPolicyRepository policies, StaffServiceRepository assignments,
                               WorkingHoursRepository workingHours,
                               AvailabilityOverrideRepository overrides,
                               BookingRepository bookings, Clock clock) {
        this.businesses = businesses;
        this.services = services;
        this.policies = policies;
        this.assignments = assignments;
        this.workingHours = workingHours;
        this.overrides = overrides;
        this.bookings = bookings;
        this.clock = clock;
    }

    /**
     * Every bookable start for a service between two dates.
     *
     * @param slug         the tenant, from the path — there is no token on this endpoint
     * @param serviceId    what is being booked; decides the duration and the buffers
     * @param from         first day, inclusive, read in {@code customerZone}
     * @param to           last day, inclusive
     * @param customerZone where those days begin and end (D11). Null means the business's own zone,
     *                     which is the right default: a customer who does not say is standing in
     *                     front of the shop
     * @param staffId      a specific person, or null for "anybody who can do this"
     */
    @Transactional(readOnly = true)
    public List<SlotResponse> slots(String slug, UUID serviceId, LocalDate from, LocalDate to,
                                    String customerZone, UUID staffId) {
        Business business = businesses.findByPublicSlug(slug)
                .orElseThrow(() -> new EntityNotFoundException("no business with slug " + slug));
        ServiceOffering service = services.findByIdAndBusinessId(serviceId, business.getId())
                .orElseThrow(() -> new EntityNotFoundException("no service " + serviceId));
        if (!service.isActive()) {
            // The same 422 plan 10 refuses the booking with, rather than a 404 or a silent empty
            // list: a deactivated service is not missing and it is not fully booked, and answering
            // "no slots" for something that will never have any is the unhelpful answer.
            throw new ApiException(ErrorCode.SERVICE_INACTIVE,
                    "service " + serviceId + " is not bookable");
        }
        BookingPolicy policy = policies.findById(business.getId())
                .orElseThrow(() -> new IllegalStateException(
                        "business " + business.getId() + " has no booking policy"));

        ZoneId businessZone = business.getTimezone();
        TimeWindow range = requestedRange(from, to, customerZone == null
                ? businessZone
                : BusinessFields.timezone(customerZone, "tz"));

        List<UUID> candidates = candidateStaff(business.getId(), serviceId, staffId);
        if (candidates.isEmpty()) {
            // Nobody performs this service, or the only person who did has been deactivated. There
            // is nothing for the three loads below to find, and asking anyway is three round trips
            // to prove it.
            return List.of();
        }

        AvailabilityQuery query = load(business, service, policy, range, candidates).query();

        return AvailabilityEngine.slots(query).stream()
                .map(AvailabilityService::toResponse)
                .toList();
    }

    // ---------------------------------------------------------------------------------
    //  one exact start — the booking path (plan 10)
    // ---------------------------------------------------------------------------------

    /**
     * Whether one specific start is bookable, and if not, whose fault that is.
     *
     * <p>Here rather than in the booking service, because everything it needs — the three loads, the
     * candidate set, the buffer-expanded windows, the policy clamp — is what {@link #slots} already
     * assembles, and a second assembly of it in another package is a second chance to feed the
     * engine {@code [starts_at, ends_at)} instead of {@code [blocked_from, blocked_to)} (D4). The
     * engine and the exclusion constraint agree because there is one loader, not two.
     *
     * <p>The business, service and policy arrive already loaded: the caller needs all three anyway
     * — to snapshot a price, to decide a deposit, to compute a cutoff — and resolving them twice
     * would double the cheap half of the booking path for nothing.
     *
     * <p>One business-zone day is scanned, not the requested range of the list endpoint.
     * {@link AvailabilityEngine#datesToScan} widens that by a day at each end on its own, which is
     * what keeps a start at 00:30 belonging to last night's shift answerable.
     *
     * @param startsAt the exact instant the customer picked, copied from a slot response
     * @param staffId  the person they asked for, or null for "anybody"
     * @throws ApiException {@code 422 STAFF_NOT_ASSIGNED} if a named staff member does not perform
     *                      this service — the one refusal that is about the request rather than
     *                      about the calendar, so it is raised here rather than reported back
     */
    @Transactional(readOnly = true)
    public SlotVerdict verify(Business business, ServiceOffering service, BookingPolicy policy,
                              Instant startsAt, UUID staffId) {
        List<UUID> candidates = candidateStaff(business.getId(), service.getId(), staffId);
        if (candidates.isEmpty()) {
            return SlotVerdict.nobody();
        }

        ZoneId businessZone = business.getTimezone();
        LocalDate day = LocalDate.ofInstant(startsAt, businessZone);
        TimeWindow range = new TimeWindow(day.atStartOfDay(businessZone).toInstant(),
                day.plusDays(1).atStartOfDay(businessZone).toInstant());

        LoadedCalendar calendar = load(business, service, policy, range, candidates);
        return new SlotVerdict(
                true,
                servedBy(AvailabilityEngine.slots(calendar.query()), startsAt),
                // The same fold with every booking removed. The engine is a pure function of its
                // query, so this is a second pass over data already in memory: no query, no clock,
                // and no second definition of what "open" means. The difference between the two
                // lists is precisely "somebody else got there first".
                servedBy(AvailabilityEngine.slots(withoutBookings(calendar.query())), startsAt),
                bookingsPerStaff(calendar.bookings(), range));
    }

    /** Who the engine offered this exact instant to, or an empty list if it offered it to nobody. */
    private static List<UUID> servedBy(List<Slot> slots, Instant start) {
        return slots.stream()
                .filter(slot -> slot.start().equals(start))
                .findFirst()
                .map(Slot::staffIds)
                .orElseGet(List::of);
    }

    private static AvailabilityQuery withoutBookings(AvailabilityQuery query) {
        List<StaffSchedule> quiet = query.staff().stream()
                .map(schedule -> new StaffSchedule(schedule.staffId(), schedule.workingHours(),
                        schedule.overrides(), List.of()))
                .toList();
        return new AvailabilityQuery(query.businessZone(), query.range(), query.durationMinutes(),
                query.bufferBeforeMinutes(), query.bufferAfterMinutes(),
                query.slotGranularityMinutes(), query.earliestStart(), query.latestStart(),
                query.businessWide(), quiet);
    }

    /**
     * How loaded a candidate's day already is, which is the tie-break for an any-staff booking.
     *
     * <p>Counted from the rows the engine was handed rather than with a {@code count(*)}, so the
     * fairness rule costs the booking path nothing. Filtered to the requested day because the load
     * window is deliberately wider than it — a night shift reaches into tomorrow — and a colleague
     * who looked busier because of a booking on an adjacent date would send the work to the wrong
     * person.
     */
    private static Map<UUID, Long> bookingsPerStaff(List<Booking> loaded, TimeWindow day) {
        return loaded.stream()
                .filter(booking -> day.contains(booking.getStartsAt()))
                .collect(Collectors.groupingBy(Booking::getStaffId, Collectors.counting()));
    }

    // ---------------------------------------------------------------------------------
    //  the three loads, shared by both callers
    // ---------------------------------------------------------------------------------

    /**
     * The engine's input, and the rows it was built from.
     *
     * <p>The bookings travel alongside the query because {@link #verify} needs to count them and
     * the query only carries them as anonymous windows. Reading them a second time would be a
     * query the loader has already paid for.
     */
    private record LoadedCalendar(AvailabilityQuery query, List<Booking> bookings) {
    }

    /**
     * Working hours, overrides and bookings — each fetched <em>once</em>, for the whole range and
     * every candidate, and folded in memory.
     *
     * <p>The span is one day wider than the request at each end: a shift or a closure belonging to
     * yesterday can still be running this morning, and one belonging to tomorrow can block a slot
     * that starts tonight. {@link AvailabilityEngine} owns that arithmetic so that the loader and
     * the scanner cannot come to disagree about it.
     */
    private LoadedCalendar load(Business business, ServiceOffering service, BookingPolicy policy,
                                TimeWindow range, List<UUID> candidates) {
        ZoneId businessZone = business.getTimezone();
        List<LocalDate> scanned = AvailabilityEngine.datesToScan(range, businessZone);
        TimeWindow loadWindow = AvailabilityEngine.loadWindow(range, businessZone);

        Map<UUID, List<WorkingHours>> template = workingHours.findForStaff(candidates).stream()
                .collect(Collectors.groupingBy(WorkingHours::getStaffId));
        List<AvailabilityOverride> allOverrides = overrides.findForEngine(
                business.getId(), candidates, scanned.getFirst(), scanned.getLast());
        List<Booking> booked = bookings.findActiveForStaffBetween(
                candidates, loadWindow.start(), loadWindow.end());
        Map<UUID, List<TimeWindow>> busy = booked.stream()
                .collect(Collectors.groupingBy(Booking::getStaffId,
                        Collectors.mapping(AvailabilityService::blockedWindow,
                                Collectors.toList())));

        // One query brought back both levels; splitting them is a partition in memory, because the
        // engine applies business-wide closures to everybody and staff rows to their owner (D5).
        Map<UUID, List<AvailabilityOverride>> ownOverrides = groupByStaff(allOverrides);
        List<AvailabilityOverride> businessWide = allOverrides.stream()
                .filter(AvailabilityOverride::isBusinessWide)
                .toList();

        List<StaffSchedule> schedules = new ArrayList<>(candidates.size());
        for (UUID candidate : candidates) {
            schedules.add(new StaffSchedule(candidate,
                    template.getOrDefault(candidate, List.of()),
                    ownOverrides.getOrDefault(candidate, List.of()),
                    busy.getOrDefault(candidate, List.of())));
        }

        Instant now = clock.instant();
        AvailabilityQuery query = new AvailabilityQuery(businessZone, range,
                service.getDurationMinutes(),
                service.getBufferBeforeMinutes(), service.getBufferAfterMinutes(),
                policy.getSlotGranularityMinutes(),
                policy.earliestBookableAt(now), policy.latestBookableAt(now),
                businessWide, schedules);
        return new LoadedCalendar(query, booked);
    }

    // ---------------------------------------------------------------------------------
    //  what was asked for
    // ---------------------------------------------------------------------------------

    /**
     * The requested days as instants. {@code ?tz=} has done its whole job by the time this returns.
     *
     * <p>{@code atStartOfDay(zone)} rather than {@code ZonedDateTime.of(date, MIDNIGHT, zone)}: in
     * the handful of zones that have at some point skipped midnight itself, the first is the first
     * valid instant of that day and the second is a local time that never happened.
     */
    private TimeWindow requestedRange(LocalDate from, LocalDate to, ZoneId customerZone) {
        rejectOutsideCalendar("from", from);
        rejectOutsideCalendar("to", to);
        if (to.isBefore(from)) {
            throw ApiException.invalidField("to", "must not be before from");
        }
        if (ChronoUnit.DAYS.between(from, to) >= MAX_RANGE_DAYS) {
            throw ApiException.invalidField("to",
                    "the range must not exceed " + MAX_RANGE_DAYS + " days");
        }
        return new TimeWindow(from.atStartOfDay(customerZone).toInstant(),
                to.plusDays(1).atStartOfDay(customerZone).toInstant());
    }

    private static void rejectOutsideCalendar(String field, LocalDate date) {
        if (date.isBefore(EARLIEST_QUERYABLE_DAY) || date.isAfter(LATEST_QUERYABLE_DAY)) {
            throw ApiException.invalidField(field, "must be between "
                    + EARLIEST_QUERYABLE_DAY + " and " + LATEST_QUERYABLE_DAY);
        }
    }

    /**
     * Who could serve this: everybody bookable, or the one person who was named.
     *
     * <p>The named case is filtered from the same list rather than checked with a query of its own,
     * because "is this person assigned, in this tenant, and still active" is exactly what that list
     * already answers — and a second spelling of it is a second chance to forget the active check.
     */
    private List<UUID> candidateStaff(UUID businessId, UUID serviceId, UUID staffId) {
        List<UUID> bookable = assignments.findBookableStaffIdsForService(serviceId, businessId);
        if (staffId == null) {
            return bookable;
        }
        if (!bookable.contains(staffId)) {
            throw new ApiException(ErrorCode.STAFF_NOT_ASSIGNED,
                    "staff member " + staffId + " does not perform service " + serviceId);
        }
        return List.of(staffId);
    }

    // ---------------------------------------------------------------------------------
    //  shaping the loaded rows
    // ---------------------------------------------------------------------------------

    private static Map<UUID, List<AvailabilityOverride>> groupByStaff(
            List<AvailabilityOverride> loaded) {
        return loaded.stream()
                .filter(Predicate.not(AvailabilityOverride::isBusinessWide))
                .collect(Collectors.groupingBy(AvailabilityOverride::getStaffId));
    }

    /**
     * A booking as the window the engine subtracts: {@code [blocked_from, blocked_to)} and not
     * {@code [starts_at, ends_at)} (D4).
     *
     * <p>The wider pair is what the calendar actually loses and what the database's exclusion
     * constraint ranges over, so subtracting it is what makes the engine and the constraint agree by
     * construction. The narrow pair would offer a start landing inside another appointment's cleanup
     * buffer, which the insert would then refuse with a 409 the customer did nothing to deserve.
     */
    private static TimeWindow blockedWindow(Booking booking) {
        return new TimeWindow(booking.getBlockedFrom(), booking.getBlockedTo());
    }

    private static SlotResponse toResponse(Slot slot) {
        return new SlotResponse(slot.start(), slot.end(), slot.staffIds());
    }
}
