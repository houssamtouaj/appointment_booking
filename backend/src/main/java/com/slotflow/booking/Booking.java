package com.slotflow.booking;

import com.slotflow.catalog.ServiceOffering;
import com.slotflow.common.jpa.AbstractMutableEntity;
import com.slotflow.tenant.TenantOwned;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

/**
 * One appointment, and the only entity in this schema with a state machine.
 *
 * <h2>The transition matrix lives here</h2>
 * Three different callers move a booking through its life — an admin {@code PATCH}, the Stripe
 * webhook, and the expiry sweeper — so the rules cannot live in any one of them. Each mutator
 * below refuses an illegal move with {@link IllegalBookingTransitionException}, which the advice
 * renders as {@code 409 ILLEGAL_TRANSITION} naming both states.
 *
 * <pre>
 *   from \ to    CONFIRMED   CANCELLED   COMPLETED        NO_SHOW
 *   PENDING      yes         yes         no               no
 *   CONFIRMED    -           yes         after endsAt     after startsAt
 *   CANCELLED    no          -           no               no
 *   COMPLETED    no          no          -                no
 *   NO_SHOW      no          yes         yes              -
 * </pre>
 *
 * <h2>Four instants, not two</h2>
 * {@code startsAt}/{@code endsAt} are what the customer sees. {@code blockedFrom}/{@code blockedTo}
 * are the same appointment widened by its buffers, and they are what the calendar actually loses
 * (D4). The database's exclusion constraint ranges over the blocked pair, so it enforces exactly
 * the rule the availability engine applies — a constraint over the raw appointment would happily
 * accept a booking landing inside another one's cleanup buffer, a row the engine would never have
 * offered.
 *
 * <h2>Terms are snapshotted</h2>
 * {@code priceCents} and both buffers are copied from the service at creation (D14). Editing a
 * service later must not rewrite the price of appointments already taken, and it must not silently
 * change the blocked range that the constraint is enforcing.
 *
 * <p>{@code @Version} is on this entity alone. It is the one row that a scheduled job, a webhook
 * and a human can all reach at the same moment.
 */
@Entity
@Table(name = "booking")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Booking extends AbstractMutableEntity implements TenantOwned {

    @Column(nullable = false, updatable = false)
    private UUID businessId;

    /**
     * Plain UUID foreign keys, not {@code @ManyToOne} graphs. The engine works on ids and ranges;
     * an object graph here buys lazy-loading surprises and an N+1 across a 30-day window, and buys
     * nothing else. Applied consistently across the whole entity — a class that is half ids and
     * half associations is where the confusion starts.
     */
    @Column(nullable = false, updatable = false)
    private UUID serviceId;

    @Column(nullable = false, updatable = false)
    private UUID staffId;

    // --- guest contact: no account, no customer_id (D1) --------------------------------
    @Column(nullable = false, length = 120, updatable = false)
    private String guestName;

    @Column(nullable = false, length = 320, updatable = false)
    private String guestEmail;

    @Column(length = 32, updatable = false)
    private String guestPhone;

    // --- what the customer sees --------------------------------------------------------
    @Column(nullable = false, updatable = false)
    private Instant startsAt;

    @Column(nullable = false, updatable = false)
    private Instant endsAt;

    // --- what the calendar loses (D4) --------------------------------------------------
    @Column(nullable = false, updatable = false)
    private Instant blockedFrom;

    @Column(nullable = false, updatable = false)
    private Instant blockedTo;

    /** No setter, by design: every change goes through a guarded transition method. */
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private BookingStatus status;

    // --- snapshotted terms (D14) ------------------------------------------------------
    @Column(nullable = false, updatable = false)
    private long priceCents;

    @Column(nullable = false)
    private long depositPaidCents;

    @Column(nullable = false, updatable = false)
    private int bufferBeforeMinutes;

    @Column(nullable = false, updatable = false)
    private int bufferAfterMinutes;

    @Column(length = 255, unique = true)
    private String stripeSessionId;

    /**
     * Stripe's hosted page for the outstanding deposit.
     *
     * <p>Stored rather than rebuilt, because it cannot be rebuilt: Stripe returns the URL once,
     * when the session is created, and the session id alone will not produce it. Three readers need
     * it and only one of them is the response to the request that created it — the "we are holding
     * your slot" email (D10) and the manage page are the other two, and without them a customer
     * whose browser crashed mid-checkout has a slot held for thirty minutes and no way to claim it.
     */
    @Column(length = 500)
    private String stripeCheckoutUrl;

    /** {@code text} in the schema, so no length here either: a note is prose. */
    private String notes;

    /** The customer's only credential for viewing or cancelling. Unique, and never reissued. */
    @Column(nullable = false, unique = true, updatable = false)
    private UUID cancellationToken;

    /** Set only while a deposit is in flight (D3); null on a confirmed booking. */
    private Instant expiresAt;

    /** Makes the reminder job idempotent: a resent reminder is a bug, not a retry. */
    private Instant reminderSentAt;

    @Version
    @Column(nullable = false)
    private long version;

    private Booking(UUID businessId, ServiceOffering service, UUID staffId, Instant startsAt,
            GuestContact guest, String notes, BookingStatus initialStatus,
            Instant expiresAt) {
        requireNotNull(businessId, "businessId");
        requireNotNull(service, "service");
        requireNotNull(guest, "guest");
        // After the null checks, not before: a null businessId compares unequal to the service's
        // own, so this message would otherwise send a reader hunting for a cross-tenant bug that
        // is not there.
        if (!service.getBusinessId().equals(businessId)) {
            throw new IllegalArgumentException("service belongs to a different business");
        }
        this.businessId = businessId;
        this.serviceId = service.getId();
        this.staffId = requireNotNull(staffId, "staffId");
        this.startsAt = requireNotNull(startsAt, "startsAt");
        this.guestName = guest.name();
        this.guestEmail = guest.email();
        this.guestPhone = guest.phone();
        this.notes = notes;

        // Derived here rather than by the caller, because getting blockedFrom wrong is the one
        // mistake that makes the exclusion constraint under-protect without anything failing.
        this.endsAt = service.endFor(startsAt);
        this.blockedFrom = service.blockedFromFor(startsAt);
        this.blockedTo = service.blockedToFor(startsAt);

        this.priceCents = service.getPriceCents();
        this.bufferBeforeMinutes = service.getBufferBeforeMinutes();
        this.bufferAfterMinutes = service.getBufferAfterMinutes();
        this.depositPaidCents = 0L;

        this.status = initialStatus;
        this.expiresAt = expiresAt;
        this.cancellationToken = UUID.randomUUID();
    }

    /**
     * A booking that needs no deposit, and is therefore confirmed the moment it exists (D2). No
     * expiry: there is nothing in flight to time out.
     */
    public static Booking confirmed(UUID businessId, ServiceOffering service, UUID staffId,
            Instant startsAt, GuestContact guest, String notes) {
        return new Booking(businessId, service, staffId, startsAt, guest, notes,
                BookingStatus.CONFIRMED, null);
    }

    /**
     * A booking holding a slot while the customer is at Stripe (D2/D3). {@code expiresAt} is not
     * optional: without it an abandoned checkout blocks the slot forever, because the exclusion
     * constraint covers {@code PENDING}.
     */
    public static Booking awaitingDeposit(UUID businessId, ServiceOffering service, UUID staffId,
            Instant startsAt, GuestContact guest, String notes,
            Instant expiresAt) {
        return new Booking(businessId, service, staffId, startsAt, guest, notes,
                BookingStatus.PENDING, requireNotNull(expiresAt, "expiresAt"));
    }

    // ---------------------------------------------------------------------------------
    //  the state machine
    // ---------------------------------------------------------------------------------

    /**
     * Deposit settled. Reached from the Stripe webhook, never from a staff action (D2), and it
     * drops the expiry — the hold is over, the booking is real.
     */
    public void confirm() {
        if (status != BookingStatus.PENDING) {
            throw new IllegalBookingTransitionException(status, BookingStatus.CONFIRMED,
                    "only a booking awaiting a deposit can be confirmed");
        }
        this.status = BookingStatus.CONFIRMED;
        this.expiresAt = null;
    }

    /**
     * Frees the slot immediately, because the exclusion constraint stops matching a cancelled row.
     *
     * <p>Reachable from {@code NO_SHOW} as well: correcting a mistaken no-show to a cancellation is
     * a real thing an owner does, and refusing it would leave the row wrong forever. The
     * cancellation <em>cutoff</em> is not checked here — it is a customer-facing policy that staff
     * override by design (plan 10), and an entity has no way to know which of the two is calling.
     */
    public void cancel() {
        if (status == BookingStatus.CANCELLED || status == BookingStatus.COMPLETED) {
            throw new IllegalBookingTransitionException(status, BookingStatus.CANCELLED,
                    "the booking has already reached a final state");
        }
        this.status = BookingStatus.CANCELLED;
        this.expiresAt = null;
    }

    /**
     * The appointment happened.
     *
     * <p>Guarded on {@code endsAt} for every source state, not only for {@code CONFIRMED}. An
     * appointment that has not finished cannot have been completed, and a "completed" booking in
     * the future is a data-quality bug that resurfaces as a wrong number on the dashboard. A
     * {@code NO_SHOW} is already past its start, so the guard costs a correcting owner nothing
     * beyond waiting for the slot to end.
     */
    public void complete(Instant now) {
        if (status != BookingStatus.CONFIRMED && status != BookingStatus.NO_SHOW) {
            throw new IllegalBookingTransitionException(status, BookingStatus.COMPLETED,
                    "only a confirmed booking or a corrected no-show can be completed");
        }
        if (now.isBefore(endsAt)) {
            throw new IllegalBookingTransitionException(status, BookingStatus.COMPLETED,
                    "the appointment has not finished yet");
        }
        this.status = BookingStatus.COMPLETED;
    }

    /** The customer did not turn up. Impossible before the appointment was due to start. */
    public void markNoShow(Instant now) {
        if (status != BookingStatus.CONFIRMED) {
            throw new IllegalBookingTransitionException(status, BookingStatus.NO_SHOW,
                    "only a confirmed booking can be marked as a no-show");
        }
        if (now.isBefore(startsAt)) {
            throw new IllegalBookingTransitionException(status, BookingStatus.NO_SHOW,
                    "the appointment has not started yet");
        }
        this.status = BookingStatus.NO_SHOW;
    }

    // ---------------------------------------------------------------------------------
    //  queries
    // ---------------------------------------------------------------------------------

    /** Whether this booking still holds its slot. */
    public boolean isActive() {
        return status.isActive();
    }

    /** True for a {@code PENDING} row the sweeper should cancel (D3). */
    public boolean hasExpired(Instant now) {
        return status == BookingStatus.PENDING && expiresAt != null && now.isAfter(expiresAt);
    }

    public boolean isReminderSent() {
        return reminderSentAt != null;
    }

    /** How much is still owed at the appointment, given what the deposit already covered. */
    public long outstandingCents() {
        return priceCents - depositPaidCents;
    }

    // ---------------------------------------------------------------------------------
    //  payment and notification bookkeeping
    // ---------------------------------------------------------------------------------

    /**
     * One booking per Checkout session, which is what makes webhook replay harmless (plan 11).
     *
     * <p>Guarded like every other mutator here, because that sentence is a claim plan 11 relies on
     * rather than a description. The webhook resolves its booking from the session metadata and then
     * checks that this row holds the id the event names; overwriting it would make the first
     * session's event disagree with the booking it belongs to, so a genuine payment would be dropped
     * in silence — and only a booking still holding its slot for a deposit has any business being
     * sent to Checkout at all.
     */
    public void attachCheckoutSession(String stripeSessionId, String stripeCheckoutUrl) {
        if (this.stripeSessionId != null) {
            throw new IllegalStateException("this booking already has a Checkout session");
        }
        // IllegalStateException, not IllegalBookingTransitionException: attaching a session is
        // bookkeeping rather than a move through the matrix, and a 409 naming the same status
        // twice would say nothing. Same choice as markReminderSent below.
        if (status != BookingStatus.PENDING) {
            throw new IllegalStateException(
                    "only a booking awaiting a deposit can be sent to Checkout");
        }
        // Both or neither. A session id with no URL is a booking the webhook can resolve and the
        // customer cannot pay; a URL with no session id is the reverse, and worse.
        this.stripeSessionId = requireNotNull(stripeSessionId, "stripeSessionId");
        this.stripeCheckoutUrl = requireNotNull(stripeCheckoutUrl, "stripeCheckoutUrl");
    }

    public void recordDepositPaid(long amountCents) {
        if (amountCents < 0 || amountCents > priceCents) {
            throw new IllegalArgumentException(
                    "deposit must be between 0 and the booking price");
        }
        this.depositPaidCents = amountCents;
    }

    /**
     * Stamped after the reminder is sent, so a second run of the job is a no-op rather than a
     * second email. Refuses to stamp twice: that would hide a double send instead of surfacing it.
     */
    public void markReminderSent(Instant now) {
        if (isReminderSent()) {
            throw new IllegalStateException("a reminder has already been sent for this booking");
        }
        this.reminderSentAt = now;
    }

    private static <T> T requireNotNull(T value, String field) {
        if (value == null) {
            throw new IllegalArgumentException(field + " must not be null");
        }
        return value;
    }
}
