package com.slotflow.booking;

import com.slotflow.availability.AvailabilityService;
import com.slotflow.availability.SlotVerdict;
import com.slotflow.business.BookingPolicy;
import com.slotflow.business.BookingPolicyRepository;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;
import com.slotflow.common.web.RateLimiter;
import com.slotflow.payment.PaymentProperties;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The booking path a guest walks: create, then look up what they got.
 *
 * <h2>The check is an optimisation; the constraint is the guarantee</h2>
 * Everything before the insert exists to produce a good error message. The one thing that makes
 * double booking impossible is {@code booking_no_overlap}, and it is impossible <em>because</em> it
 * is enforced by Postgres over a range type rather than by a read followed by a write. Two requests
 * that both pass every check below, at the same instant, for the same slot, produce one row and one
 * {@code 23P01}. See {@link BookingConflictException}.
 *
 * <h2>Where the refusals come from, and why the order is what it is</h2>
 * Plan 10 lists the fast rejects before the engine call, and they mostly are: an inactive service, a
 * staff member who does not perform it, a start inside the lead time or beyond the horizon are all
 * decided from three rows already in hand. The two <em>slot</em> refusals are not, and cannot be:
 *
 * <ul>
 *   <li>{@code SLOT_NOT_ON_GRID} cannot be a fast reject, because the grid is not anchored at
 *       midnight. Plan 09 anchors it at each open window's own start, so after a booking ending at
 *       13:15 the next offer on a half-hour grid is 13:45 — a start the engine really does offer and
 *       a midnight-anchored modulo would refuse. Checking it up front would reject slots this very
 *       API had just advertised.</li>
 *   <li>{@code SLOT_OUTSIDE_HOURS} needs the working hours, the overrides and the closures, which
 *       is the engine's whole input.</li>
 * </ul>
 *
 * So both are decided from {@link SlotVerdict} after the engine has spoken, and the grid check is
 * used only to choose <em>which</em> of the two to name. That is a deviation from the plan's step
 * ordering and not from its outcome: the same two codes come back for the same two mistakes.
 *
 * <h2>Not offered is not the same as taken</h2>
 * A start the engine withheld because somebody else already has it is a {@code 409} — the client
 * should refetch and re-render, and the constraint would have said the same a moment later. A start
 * it would never have offered on an empty calendar is a {@code 422}: refetching will not help,
 * because the answer will not change. {@link SlotVerdict} is what lets these two be told apart
 * without a second trip to the database.
 */
@Service
public class PublicBookingService {

    private static final Logger log = LoggerFactory.getLogger(PublicBookingService.class);

    /**
     * How long a {@code PENDING} booking holds its slot while the customer is at Stripe (D3).
     *
     * <p>Long enough to find a card, short enough that an abandoned checkout is not a slot lost for
     * the evening. It is also the deadline the sweeper enforces and, from plan 11, the expiry set on
     * the Checkout session itself — one number, three users, so it is a constant rather than three
     * literals.
     */
    static final Duration DEPOSIT_HOLD = Duration.ofMinutes(30);

    private final BusinessRepository businesses;
    private final ServiceOfferingRepository services;
    private final BookingPolicyRepository policies;
    private final BookingRepository bookings;
    private final AvailabilityService availability;
    private final RateLimiter rateLimiter;
    private final PaymentProperties payments;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public PublicBookingService(BusinessRepository businesses, ServiceOfferingRepository services,
                                BookingPolicyRepository policies, BookingRepository bookings,
                                AvailabilityService availability, RateLimiter rateLimiter,
                                PaymentProperties payments, ApplicationEventPublisher events,
                                Clock clock) {
        this.businesses = businesses;
        this.services = services;
        this.policies = policies;
        this.bookings = bookings;
        this.availability = availability;
        this.rateLimiter = rateLimiter;
        this.payments = payments;
        this.events = events;
        this.clock = clock;
    }

    // ---------------------------------------------------------------------------------
    //  creation
    // ---------------------------------------------------------------------------------

    /**
     * Turns a slot into a row, or explains precisely why it could not.
     *
     * @param slug the tenant, from the path — there is no token on this endpoint
     */
    @Transactional
    public PublicBookingResponse create(String slug, BookingRequest request) {
        Business business = businesses.findByPublicSlug(slug)
                .orElseThrow(() -> new EntityNotFoundException("no business with slug " + slug));

        // Built before anything else is loaded: the record normalises the address, and the
        // normalised one is the rate-limiting key. Limiting on the raw string would let
        // Alex@example.test and alex@example.test spend two separate budgets (D12).
        GuestContact guest = guestFrom(request);
        enforceGuestBudget(guest.email());

        ServiceOffering service = services
                .findByIdAndBusinessId(request.serviceId(), business.getId())
                .orElseThrow(() -> new EntityNotFoundException("no service " + request.serviceId()));
        if (!service.isActive()) {
            throw new ApiException(ErrorCode.SERVICE_INACTIVE,
                    "service " + service.getId() + " is not bookable");
        }
        BookingPolicy policy = policies.findById(business.getId())
                .orElseThrow(() -> new IllegalStateException(
                        "business " + business.getId() + " has no booking policy"));

        Instant now = clock.instant();
        Instant startsAt = request.startsAt();
        rejectOutsidePolicyWindow(policy, startsAt, now);

        // Throws 422 STAFF_NOT_ASSIGNED for a named staff member who does not perform this service.
        SlotVerdict verdict = availability.verify(business, service, policy, startsAt,
                request.staffId());
        UUID staffId = chooseStaff(verdict, business, service, policy, startsAt, request.staffId());

        Booking booking = requiresDeposit(business)
                ? Booking.awaitingDeposit(business.getId(), service, staffId, startsAt, guest,
                        request.notes(), now.plus(DEPOSIT_HOLD))
                : Booking.confirmed(business.getId(), service, staffId, startsAt, guest,
                        request.notes());

        insert(booking);

        // Inside the transaction, delivered after it commits. Nothing a customer receives may
        // describe a booking that did not survive its own insert; see BookingEvent.
        events.publishEvent(new BookingEvent.Created(booking.getId(), business.getId(),
                booking.getStatus() == BookingStatus.PENDING));
        log.info("Booking {} created {} for staff {} at {} in business {}", booking.getId(),
                booking.getStatus(), staffId, startsAt, business.getId());
        return PublicBookingResponse.created(booking, business, policy, now);
    }

    /**
     * The insert, and the only place in the application that translates {@code 23P01}.
     *
     * <p>{@code saveAndFlush}, not {@code save}, and that is the load-bearing word. A plain
     * {@code save} leaves the INSERT in the persistence context until commit, which happens
     * <em>after</em> this method returns and outside any {@code catch} — so the exclusion violation
     * would surface from the transaction interceptor as a generic {@code 409 DATA_CONFLICT} with no
     * slot in the body, on the one code path this whole plan is about. Flushing here is what puts
     * the statement inside the try.
     */
    private void insert(Booking booking) {
        try {
            bookings.saveAndFlush(booking);
        } catch (DataIntegrityViolationException violation) {
            if (BookingConflictException.isSlotOverlap(violation)) {
                throw conflictOver(booking);
            }
            // Some other invariant broke — a duplicate token, a check constraint. That is a bug on
            // this side and must not be reported to a customer as "somebody took your slot".
            throw violation;
        } catch (CannotAcquireLockException deadlock) {
            // The other way two racing bookings are separated, and the one nobody expects.
            //
            // When the two blocked ranges are identical, the second inserter waits on the first and
            // gets a clean 23P01. When they merely *overlap* — 09:30 with a cleanup buffer against
            // 11:00 with a setup buffer — each transaction can end up waiting on the other's index
            // entry, and Postgres resolves the cycle by killing one of them with 40P01. The
            // survivor commits, so the outcome is still exactly one booking; only the shape of the
            // loser's exception differs.
            //
            // Reported as the same 409, because to the caller it is the same event: somebody else
            // is taking that slot, and refetching the availability is the right next move. Left
            // unmapped it is a 500 on a perfectly ordinary pair of simultaneous customers, which is
            // both a lie and unactionable. It is genuinely transient — the other transaction may yet
            // roll back — but "refetch and pick again" is the correct client action either way.
            log.info("Deadlock while booking {} for staff {}; another overlapping booking is in "
                    + "flight", booking.getStartsAt(), booking.getStaffId(), deadlock);
            throw conflictOver(booking);
        }
    }

    private static BookingConflictException conflictOver(Booking booking) {
        return new BookingConflictException(booking.getStaffId(), booking.getStartsAt(),
                booking.getEndsAt());
    }

    // ---------------------------------------------------------------------------------
    //  the manage page
    // ---------------------------------------------------------------------------------

    /**
     * The customer's whole view of their booking. The token is the credential; there is no
     * other, and cancelling through it is the next commit's subject.
     */
    @Transactional(readOnly = true)
    public PublicBookingResponse byToken(UUID cancellationToken) {
        Booking booking = load(cancellationToken);
        return withContext(booking, PublicBookingResponse::forToken);
    }

    // ---------------------------------------------------------------------------------
    //  the refusals
    // ---------------------------------------------------------------------------------

    /**
     * The two policy edges, named separately because they are opposite mistakes with opposite fixes:
     * one customer is too eager and the other is planning next year.
     *
     * <p>Both carry the boundary they crossed, so the page can say "the earliest we can take you is
     * 11:00" rather than "no".
     */
    private static void rejectOutsidePolicyWindow(BookingPolicy policy, Instant startsAt,
                                                  Instant now) {
        Instant earliest = policy.earliestBookableAt(now);
        if (startsAt.isBefore(earliest)) {
            throw new ApiException(ErrorCode.POLICY_LEAD_TIME,
                    "This business needs more notice than that.")
                    .with("earliestStart", earliest);
        }
        Instant latest = policy.latestBookableAt(now);
        if (startsAt.isAfter(latest)) {
            throw new ApiException(ErrorCode.POLICY_MAX_ADVANCE,
                    "That is further ahead than this business takes bookings.")
                    .with("latestStart", latest);
        }
    }

    /**
     * Who takes the appointment, or why nobody can.
     *
     * <p>The happy path is one line: the engine offered the start, and the candidate with the
     * lightest day takes it (plan 09). Everything else in here is the answer to "why not", and the
     * order matters — taken first, because that is the only refusal a client can do something about.
     */
    private UUID chooseStaff(SlotVerdict verdict, Business business, ServiceOffering service,
                             BookingPolicy policy, Instant startsAt, UUID requestedStaffId) {
        if (verdict.isBookable()) {
            return verdict.preferredStaff().orElseThrow();
        }
        if (verdict.isTakenByAnotherBooking()) {
            // The calendar would have offered this on a quiet day, so the only thing in the way is
            // another booking. Answering here rather than letting the insert fail gives the client
            // the same 409 either way, without spending a write to find out.
            throw new BookingConflictException(requestedStaffId, startsAt, service.endFor(startsAt));
        }
        if (!verdict.anyCandidateStaff()) {
            // A service with no bookable performer produces no slots at all, ever. The availability
            // endpoint answers that with an empty list, which is the right answer to "show me the
            // menu"; here it is a refusal, and it has to name the reason or the customer is left
            // staring at a calendar that will never fill in.
            throw new ApiException(ErrorCode.STAFF_NOT_ASSIGNED,
                    "Nobody at this business currently performs that service.");
        }
        throw isOnTheGrid(startsAt, business.getTimezone(), policy)
                ? new ApiException(ErrorCode.SLOT_OUTSIDE_HOURS,
                        "Nobody is working then. Pick a start from the availability list.")
                        .with("startsAt", startsAt)
                : new ApiException(ErrorCode.SLOT_NOT_ON_GRID,
                        "That is not one of the start times this business offers.")
                        .with("startsAt", startsAt)
                        .with("slotGranularityMinutes", policy.getSlotGranularityMinutes());
    }

    /**
     * Whether the start sits on the granularity grid measured from the business-zone start of its
     * own day.
     *
     * <p>Only ever used to pick between two 422s, never to refuse on its own — see the class note on
     * why an anchored grid makes this a poor gate and a decent explanation. Measured in the business
     * zone because that is where the day begins, and a grid anchored to UTC midnight would be off by
     * the offset in every zone that has one.
     */
    private static boolean isOnTheGrid(Instant startsAt, ZoneId businessZone, BookingPolicy policy) {
        Instant midnight = LocalDate.ofInstant(startsAt, businessZone)
                .atStartOfDay(businessZone).toInstant();
        long step = policy.getSlotGranularityMinutes() * 60L;
        long secondsIntoTheDay = Duration.between(midnight, startsAt).getSeconds();
        return secondsIntoTheDay >= 0 && secondsIntoTheDay % step == 0;
    }

    /**
     * D12, the half of the rate limiter no filter can enforce: the key is in the parsed body.
     *
     * <p>Per email rather than per IP because the IP budget is already spent by
     * {@code RateLimitFilter}, and the two catch different abusers — one machine hammering the
     * endpoint, versus one address hoarding slots across a botnet.
     */
    private void enforceGuestBudget(String email) {
        RateLimiter.Decision decision =
                rateLimiter.tryConsume(RateLimiter.Scope.GUEST_BOOKING, email);
        if (!decision.allowed()) {
            throw new ApiException(ErrorCode.RATE_LIMITED,
                    "Too many bookings from this email address. Try again in %d second(s)."
                            .formatted(decision.retryAfterSeconds()))
                    .with(ApiException.RETRY_AFTER_SECONDS, decision.retryAfterSeconds());
        }
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private static GuestContact guestFrom(BookingRequest request) {
        return new GuestContact(request.guestName(), request.guestEmail(), request.guestPhone());
    }

    /**
     * A token that resolves to nothing is a {@code 404}, exactly like one that never existed. The
     * token is 122 bits of randomness and the only credential a customer has; an endpoint that
     * distinguished "wrong" from "cancelled" would be a slow oracle over that space.
     */
    private Booking load(UUID cancellationToken) {
        return bookings.findByCancellationToken(cancellationToken)
                .orElseThrow(() -> new EntityNotFoundException("no booking for that token"));
    }

    private BookingPolicy policyFor(Booking booking) {
        return policies.findById(booking.getBusinessId())
                .orElseThrow(() -> new IllegalStateException(
                        "business " + booking.getBusinessId() + " has no booking policy"));
    }

    /** The two rows a customer-facing response needs beyond the booking itself. */
    private PublicBookingResponse withContext(Booking booking, Renderer renderer) {
        Business business = businesses.findById(booking.getBusinessId())
                .orElseThrow(() -> new IllegalStateException(
                        "booking " + booking.getId() + " has no business"));
        return renderer.render(booking, business, policyFor(booking), clock.instant());
    }

    @FunctionalInterface
    private interface Renderer {
        PublicBookingResponse render(Booking booking, Business business, BookingPolicy policy,
                                     Instant now);
    }

    /** D2, gated by the feature flag: with payments off, nothing is ever created {@code PENDING}. */
    private boolean requiresDeposit(Business business) {
        return payments.enabled() && business.requiresDeposit();
    }
}
