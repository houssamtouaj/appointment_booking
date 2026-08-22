package com.slotflow.booking;

/**
 * The three contact fields, on the wire.
 *
 * <p>A record of its own rather than three flat members, so that "does this response carry guest
 * contact details" is a question about one field and answerable by reading a type. There are
 * exactly two responses that hold one — the admin detail view and the token lookup — and
 * {@code BookingPrivacyIT} asserts the rest of the surface does not.
 *
 * @param phone null when the customer did not give one, and then absent from the JSON entirely
 */
public record GuestContactResponse(String name, String email, String phone) {

    static GuestContactResponse of(Booking booking) {
        return new GuestContactResponse(booking.getGuestName(), booking.getGuestEmail(),
                booking.getGuestPhone());
    }
}
