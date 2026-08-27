package com.slotflow.booking;

import com.slotflow.common.web.PageResponse;
import com.slotflow.tenant.TenantContext;
import jakarta.persistence.EntityNotFoundException;
import java.time.Clock;
import java.time.Instant;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The bookings a business can see and act on.
 *
 * <p>Scoping follows the same rule as every other admin service, and the split of status codes is
 * the one {@link TenantContext} exists to enforce: the list and the detail read pass the business id
 * into the query, so another tenant's row is never loaded and comes back as {@code 404}; the status
 * transition loads by id and then goes through {@link TenantContext#requireOwnedForWrite}, which is
 * the {@code 403}.
 *
 * <h2>The transition matrix is not here</h2>
 * It is on {@link Booking}, and this class does nothing but pick which mutator to call. Three
 * callers move a booking through its life — this endpoint, the Stripe webhook (plan 11) and the
 * expiry sweeper — and a rule enforced in one of them protects only that one. What <em>is</em> here
 * is the one refusal that belongs to this endpoint rather than to the entity: staff never confirm
 * anything (D2).
 */
@Service
public class BookingAdminService {

    private static final Logger log = LoggerFactory.getLogger(BookingAdminService.class);

    /**
     * A calendar reads forwards, and {@code ?sort=} is deliberately not honoured for the same reason
     * as in the catalog: a page of an unsorted query is whatever order Postgres found the rows in,
     * so page 2 can repeat a row from page 1 and drop another. The id tiebreak matters more here
     * than anywhere else — two staff members genuinely do start appointments at 09:00.
     */
    private static final Sort BY_START = Sort.by(Sort.Order.asc("startsAt"), Sort.Order.asc("id"));

    private final BookingRepository bookings;
    private final TenantContext tenant;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    public BookingAdminService(BookingRepository bookings, TenantContext tenant,
            ApplicationEventPublisher events, Clock clock) {
        this.bookings = bookings;
        this.tenant = tenant;
        this.events = events;
        this.clock = clock;
    }

    // ---------------------------------------------------------------------------------
    //  reads
    // ---------------------------------------------------------------------------------

    /**
     * One page of the calendar, filtered by whichever of the four filters were sent.
     *
     * <p>Every combination of them is ANDed with the caller's own business id, which is what makes
     * "tenant A never sees a tenant B row under any filter combination" a property of the query
     * shape rather than a thing this method has to remember. A {@code staffId} pointing at a foreign
     * staff member is not an error and not a 403: it is a filter that matches nothing, which is the
     * only answer that does not confirm the id exists.
     *
     * <p>Rows carry no email address or phone number — see {@link BookingSummaryResponse}. Those
     * live on the detail view alone, so a leak has one place to happen instead of forty.
     */
    @Transactional(readOnly = true)
    public PageResponse<BookingSummaryResponse> list(Instant from, Instant to, BookingStatus status,
            UUID staffId, Pageable pageable) {
        Pageable sorted = PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), BY_START);
        Page<Booking> page = bookings.findAll(
                BookingSpecifications.ofBusiness(tenant.businessId(), from, to, status, staffId),
                sorted);
        return PageResponse.of(page, BookingSummaryResponse::of);
    }

    /** A read, so another tenant's id is reported as absent rather than as forbidden. */
    @Transactional(readOnly = true)
    public BookingResponse get(UUID id) {
        return BookingResponse.of(bookings.findByIdAndBusinessId(id, tenant.businessId())
                .orElseThrow(() -> new EntityNotFoundException("booking " + id)));
    }

    // ---------------------------------------------------------------------------------
    //  the one write
    // ---------------------------------------------------------------------------------

    /**
     * Moves a booking through the matrix, or refuses with {@code 409 ILLEGAL_TRANSITION}.
     *
     * <p>Staff cancelling ignores the cancellation cutoff, by design: the cutoff is a promise made
     * to customers about how late <em>they</em> may change their mind, and a business that cannot
     * cancel its own appointment when a staff member calls in sick has a scheduling system that
     * fights it. The customer-facing cutoff lives in {@code PublicBookingService} for exactly that
     * reason — it is a property of the endpoint, not of the booking.
     *
     * <p>The two time guards are the entity's and are not overridable here either: a booking cannot
     * be completed before it has finished or marked a no-show before it was due to start. Both are
     * data-quality bugs that resurface as wrong numbers on the dashboard (plan 13), and an owner who
     * really wants to close today's appointment early is asking for the clock to be wrong.
     */
    @Transactional
    public BookingResponse transition(UUID id, BookingStatus target) {
        Booking booking = tenant.requireOwnedForWrite(bookings.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("booking " + id)));
        BookingStatus from = booking.getStatus();
        Instant now = clock.instant();

        switch (target) {
        case CANCELLED -> booking.cancel();
        case COMPLETED -> booking.complete(now);
        case NO_SHOW -> booking.markNoShow(now);
        // D2. PENDING means one thing — a deposit is in flight — and CONFIRMED is what the
        // webhook or the absence of a deposit produces. Neither is a button, so both are
        // refused here whatever the current status, in the same 409 shape as the rest of the
        // matrix rather than as a 400 about an unknown value.
        case CONFIRMED -> throw new IllegalBookingTransitionException(from, target,
                "a deposit confirms a booking, staff do not");
        case PENDING -> throw new IllegalBookingTransitionException(from, target,
                "only a deposit going out puts a booking on hold");
        }

        bookings.save(booking);
        if (target == BookingStatus.CANCELLED) {
            events.publishEvent(new BookingEvent.Cancelled(booking.getId(), booking.getBusinessId(),
                    BookingEvent.Cancelled.Source.STAFF, now));
        }
        log.info("Booking {} moved {} -> {} by user {}", booking.getId(), from, target,
                tenant.userId());
        return BookingResponse.of(booking);
    }
}
