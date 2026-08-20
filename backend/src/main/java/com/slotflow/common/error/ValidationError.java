package com.slotflow.common.error;

/**
 * One entry of the {@code errors[]} array in a {@code 422} body.
 *
 * <p>This is the shape the React forms parse to attach messages to inputs, so the pair of
 * names is a published contract: {@code field} is the request-body path
 * ({@code durationMinutes}, {@code guest.email}), {@code message} is the human message.
 */
public record ValidationError(String field, String message) {
}
