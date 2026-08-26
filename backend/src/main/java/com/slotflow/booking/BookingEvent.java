package com.slotflow.booking;

import java.time.Instant;
import java.util.UUID;

/**
 * Something that happened to a booking, published inside the transaction that made it happen and
 * delivered <b>after that transaction commits</b>.
 *
 * <h2>Why this exists a wave before it has any real subscriber</h2>
 * Payments (plan 11) and notifications (plan 12) both hang off these moments, and both of them
 * send something a customer receives. A {@code @TransactionalEventListener(AFTER_COMMIT)} retrofitted
 * later is how a rolled-back booking ends up emailing a confirmation for an appointment nobody has:
 * the send succeeds, the commit does not, and there is no row to explain the mail anybody got. The
 * boundary is cheap to put in now and expensive to remember to put in later, so it goes in now with
 * {@link BookingEventListener} logging on the other side of it.
 *
 * <p>It is a separate type from {@code NotificationRequest} on purpose. That one says "send this
 * message"; these say "this happened". Plan 11 subscribes to {@link Created} to open a Checkout
 * session, which is not a message at all, and a booking has no business knowing which of its
 * consequences is an email.
 *
 * <p>Ids rather than entities. The listener runs after commit, outside the persistence context that
 * loaded the row, so a detached entity travelling on the event is a lazy-loading exception waiting
 * for a subscriber that touches the wrong field. A subscriber that needs the booking reads it.
 *
 * <p>Sealed, so a third kind of event cannot be added without the listener growing a branch for it.
 */
public sealed interface BookingEvent {

    UUID bookingId();

    UUID businessId();

    /**
     * A booking exists. {@code CONFIRMED} outright, or {@code PENDING} while a deposit is in flight
     * (D2) — plan 11 reads {@link #awaitingDeposit()} to decide whether to open a Checkout session,
     * and plan 12 reads it to choose between the two confirmation emails (D10).
     */
    record Created(UUID bookingId, UUID businessId, boolean awaitingDeposit)
            implements BookingEvent {
    }

    /**
     * A deposit arrived and the booking stopped being a hold (D2). Published by the Stripe webhook
     * and by nothing else — staff never confirm anything, and a booking that needed no deposit was
     * born {@code CONFIRMED} and announced itself through {@link Created}.
     *
     * <p>That is precisely why this is a separate event rather than a second {@code Created} or a
     * flag on it: the two paths owe the customer a different number of emails. No deposit is one
     * message, a deposit is <em>received</em> then <em>confirmed</em>, and a design where both
     * paths publish the same event is the design that sends two confirmations for one booking
     * (D10). Here the confirmation email has exactly one publisher.
     *
     * @param depositPaidCents what Stripe actually took, in minor units, so a subscriber does not
     *                         have to re-read the row to say what was charged
     */
    record Confirmed(UUID bookingId, UUID businessId, long depositPaidCents)
            implements BookingEvent {
    }

    /**
     * A booking stopped holding its slot, whoever ended it.
     *
     * @param source who cancelled, because the three callers want different messages: a customer
     *               cancelling gets an acknowledgement, a business cancelling owes an apology, and
     *               an expired deposit hold is a slot quietly released to a customer who has
     *               already walked away
     */
    record Cancelled(UUID bookingId, UUID businessId, Source source, Instant at)
            implements BookingEvent {

        public enum Source {
            /** The manage page, with the cancellation token, inside the cutoff. */
            GUEST,
            /** {@code PATCH /api/bookings/{id}/status}. The business can always cancel. */
            STAFF,
            /** The sweeper (D3): a deposit that never arrived. */
            EXPIRY
        }
    }
}
