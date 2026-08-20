package com.slotflow.booking;

import java.util.Locale;

/**
 * How to reach the person who booked. Three fields that always travel together, so they travel as
 * one value.
 *
 * <p>There is no customer account behind them (D1): this is the entire identity of a booking's
 * customer, and the {@code cancellationToken} is their only credential. That makes these three
 * fields the most sensitive data in the schema — they appear in exactly two responses, the
 * token lookup and the admin detail view, and nowhere else (plan 10).
 *
 * @param name  what the confirmation email says hello to
 * @param email where the confirmation, the reminder and the manage link go
 * @param phone optional; some businesses ring ahead, most do not
 */
public record GuestContact(String name, String email, String phone) {

    public GuestContact {
        name = requireText(name, "guest name");
        email = requireText(email, "guest email").toLowerCase(Locale.ROOT);
        phone = phone == null || phone.isBlank() ? null : phone.trim();
    }

    private static String requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
        return value.trim();
    }
}
