package com.slotflow.notification;

import com.slotflow.booking.Booking;
import com.slotflow.booking.BookingRepository;
import com.slotflow.booking.BookingStatus;
import com.slotflow.business.Business;
import com.slotflow.business.BusinessRepository;
import com.slotflow.catalog.ServiceOffering;
import com.slotflow.catalog.ServiceOfferingRepository;
import com.slotflow.common.web.FrontendLinks;
import com.slotflow.notification.NotificationService.Recipient;
import com.slotflow.staff.User;
import com.slotflow.staff.UserRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns a booking id into everything six templates need, in one place.
 *
 * <h2>Why the reads happen here and not in the template</h2>
 * {@code Booking} holds plain UUID foreign keys rather than an object graph, which is the right
 * shape for the availability engine and means a template cannot walk from a booking to the service
 * it is for. Rather than give the entity associations it does not otherwise want, this resolves the
 * four rows once and hands over a {@link BookingNotification} of values. That also settles the
 * lazy-loading question permanently: the send happens on another thread with no persistence context,
 * so anything still needing a database at render time would be an exception nobody sees.
 *
 * <h2>{@code REQUIRES_NEW}, deliberately</h2>
 * Every caller runs after the booking's own transaction has committed — an
 * {@code AFTER_COMMIT} listener, or the reminder job between two of its per-booking transactions.
 * Reading through the completed one happens to work today and is exactly the sort of thing that
 * changes behaviour under a different transaction manager or a nested listener. A new read-only
 * transaction is what this actually wants and is one word to say so.
 *
 * <p>Missing rows are an {@code IllegalStateException} rather than an empty message. A booking whose
 * business, service or staff member has vanished is a foreign-key violation that the schema makes
 * impossible; if it happens anyway, a loud failure in a log with the booking id in it is worth far
 * more than a confirmation email addressed from nobody about nothing.
 */
@Service
class BookingNotificationFactory {

    private final BookingRepository bookings;
    private final BusinessRepository businesses;
    private final ServiceOfferingRepository services;
    private final UserRepository users;
    private final FrontendLinks links;

    BookingNotificationFactory(BookingRepository bookings, BusinessRepository businesses,
            ServiceOfferingRepository services, UserRepository users,
            FrontendLinks links) {
        this.bookings = bookings;
        this.businesses = businesses;
        this.services = services;
        this.users = users;
        this.links = links;
    }

    /**
     * @return the message data, or empty if the booking has been deleted since the event was
     *         published. Empty rather than an exception because that is a race and not a bug —
     *         nothing in this application deletes bookings, but a manual cleanup during a demo
     *         should not produce a stack trace
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW, readOnly = true)
    public Optional<BookingNotification> forBooking(UUID bookingId) {
        return bookings.findById(bookingId).map(this::compose);
    }

    BookingNotification compose(Booking booking) {
        Business business = businesses.findById(booking.getBusinessId())
                .orElseThrow(() -> missing("business", booking));
        ServiceOffering service = services.findById(booking.getServiceId())
                .orElseThrow(() -> missing("service", booking));
        User staff = users.findById(booking.getStaffId())
                .orElseThrow(() -> missing("staff member", booking));

        return new BookingNotification(
                new Recipient(booking.getGuestEmail(), booking.getGuestName()),
                booking.getId(),
                booking.getCancellationToken(),
                business.getName(),
                business.getTimezone(),
                service.getName(),
                staff.getFullName(),
                booking.getStartsAt(),
                booking.getEndsAt(),
                business.getCurrency(),
                booking.getPriceCents(),
                // What Stripe is being asked for, recomputed from the business rather than read
                // from anywhere a client could have influenced. Zero unless a deposit is owed, and
                // the same call the Checkout session is built from (plan 11), so the email and the
                // charge cannot disagree.
                business.depositFor(booking.getPriceCents()),
                booking.getDepositPaidCents(),
                booking.getExpiresAt(),
                // Only while there is something to pay, matching PublicBookingResponse. The column
                // outlives the payment — it is what the confirming webhook resolved — and a "pay
                // the deposit" link in a mail about a booking that is already paid is a customer
                // paying twice.
                booking.getStatus() == BookingStatus.PENDING ? booking.getStripeCheckoutUrl() : null,
                links.manageBooking(booking.getCancellationToken()));
    }

    private static IllegalStateException missing(String what, Booking booking) {
        return new IllegalStateException(
                "booking " + booking.getId() + " has no " + what);
    }
}
