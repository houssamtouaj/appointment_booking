package com.slotflow.common.error;

import java.net.URI;
import java.util.Locale;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;

/**
 * The machine-readable half of every error response.
 *
 * <p>The frontend switches on {@code code}; {@code detail} is prose for humans and may be
 * reworded at any time without breaking a client. That contract only holds if the codes are
 * declared in one place, so this enum is the whole vocabulary of the API — including codes
 * for endpoints that do not exist yet. Naming them here is the point of plan 04: an endpoint
 * written later picks a code from this list instead of inventing a fifth spelling of
 * "that slot is taken".
 *
 * <p>Each constant carries the status it maps to, so the exception-to-status table lives next
 * to the codes rather than being scattered across handlers.
 */
public enum ErrorCode {

    // --- Request shape and framework failures -----------------------------------------
    /** Bean-validation or constraint failure. Always accompanied by a populated {@code errors[]}. */
    VALIDATION_FAILED(HttpStatus.UNPROCESSABLE_ENTITY, "Validation failed"),
    /** Unparseable or unknown-property JSON, a bad enum literal, a malformed UUID in a path. */
    MALFORMED_REQUEST(HttpStatus.BAD_REQUEST, "Malformed request"),
    MISSING_PARAMETER(HttpStatus.BAD_REQUEST, "Missing request parameter"),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "Method not allowed"),
    UNSUPPORTED_MEDIA_TYPE(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Unsupported media type"),
    NOT_ACCEPTABLE(HttpStatus.NOT_ACCEPTABLE, "Not acceptable"),

    // --- Generic outcomes --------------------------------------------------------------
    /**
     * Also returned for a cross-tenant <em>read</em>: the API must not confirm that another
     * tenant's id exists.
     */
    NOT_FOUND(HttpStatus.NOT_FOUND, "Not found"),
    /** Missing or invalid credentials. Never says whether the email existed. */
    UNAUTHENTICATED(HttpStatus.UNAUTHORIZED, "Authentication required"),
    /** Authenticated but not allowed — including a cross-tenant <em>write</em>. */
    ACCESS_DENIED(HttpStatus.FORBIDDEN, "Access denied"),
    /** A database constraint said no and no more specific code applies. */
    DATA_CONFLICT(HttpStatus.CONFLICT, "Conflict"),
    RATE_LIMITED(HttpStatus.TOO_MANY_REQUESTS, "Too many requests"),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "Internal server error"),

    // --- Identity and tenancy (plans 05, 06) -------------------------------------------
    SLUG_TAKEN(HttpStatus.CONFLICT, "Slug already taken"),
    EMAIL_TAKEN(HttpStatus.CONFLICT, "Email already registered"),
    /** A refresh token that already has a successor was presented — treated as theft. */
    REFRESH_REUSED(HttpStatus.UNAUTHORIZED, "Refresh token reused"),
    INVITATION_CONSUMED(HttpStatus.GONE, "Invitation no longer valid"),
    LAST_OWNER(HttpStatus.CONFLICT, "Last owner cannot be deactivated"),

    // --- Catalog and configuration (plans 07, 08) --------------------------------------
    STAFF_NOT_IN_BUSINESS(HttpStatus.UNPROCESSABLE_ENTITY, "Staff member not in this business"),
    HOURS_OVERLAP(HttpStatus.UNPROCESSABLE_ENTITY, "Working hours overlap"),
    /** Changing the business timezone shifts every future slot; it needs an explicit confirm. */
    TIMEZONE_SHIFT_UNCONFIRMED(HttpStatus.CONFLICT, "Timezone change not confirmed"),

    // --- Booking (plan 10) -------------------------------------------------------------
    SERVICE_INACTIVE(HttpStatus.UNPROCESSABLE_ENTITY, "Service is not bookable"),
    STAFF_NOT_ASSIGNED(HttpStatus.UNPROCESSABLE_ENTITY, "Staff member does not perform this service"),
    POLICY_LEAD_TIME(HttpStatus.UNPROCESSABLE_ENTITY, "Too soon to book"),
    POLICY_MAX_ADVANCE(HttpStatus.UNPROCESSABLE_ENTITY, "Too far in advance"),
    SLOT_NOT_ON_GRID(HttpStatus.UNPROCESSABLE_ENTITY, "Start time is not on the slot grid"),
    SLOT_OUTSIDE_HOURS(HttpStatus.UNPROCESSABLE_ENTITY, "Start time is outside working hours"),
    /** The one the exclusion constraint produces. Carries the requested slot in the body. */
    BOOKING_SLOT_TAKEN(HttpStatus.CONFLICT, "Slot already booked"),
    ILLEGAL_TRANSITION(HttpStatus.CONFLICT, "Illegal status transition"),
    CANCELLATION_CUTOFF(HttpStatus.CONFLICT, "Past the cancellation cutoff"),

    // --- Payments (plan 11) ------------------------------------------------------------
    /**
     * Stripe refused or could not be reached. A {@code 502} and not a {@code 500}: the request was
     * fine and a dependency was not, so a client retrying in a minute may well succeed.
     */
    PAYMENT_UNAVAILABLE(HttpStatus.BAD_GATEWAY, "Payments are temporarily unavailable"),
    /**
     * The only thing standing between this API and anyone who can POST to a public path claiming a
     * booking is paid. The body says nothing beyond this — no header echo, no reason, no timestamp
     * comparison — because every detail is a hint to somebody trying to forge one.
     */
    WEBHOOK_SIGNATURE_INVALID(HttpStatus.BAD_REQUEST, "Invalid webhook signature");

    /**
     * Namespace for the {@code type} member of every problem body. It is a stable identifier
     * first and a documentation URL second — RFC 7807 allows both, and clients must match on
     * the string, not dereference it.
     */
    private static final String TYPE_NAMESPACE = "https://slotflow.dev/problems/";

    private final HttpStatus status;
    private final String title;

    ErrorCode(HttpStatus status, String title) {
        this.status = status;
        this.title = title;
    }

    public HttpStatus status() {
        return status;
    }

    /** Short, human-readable summary of the code. Stable per RFC 7807. */
    public String title() {
        return title;
    }

    /** {@code SLOT_NOT_ON_GRID} becomes {@code .../problems/slot-not-on-grid}. */
    public URI type() {
        return URI.create(TYPE_NAMESPACE + name().toLowerCase(Locale.ROOT).replace('_', '-'));
    }

    /**
     * The code to report for a status Spring produced on its own, before any of our code ran
     * (an unmapped media type, a missing parameter). Keeps those responses inside the same
     * contract instead of leaking Boot's default body.
     */
    public static ErrorCode forStatus(HttpStatusCode status) {
        return switch (status.value()) {
        case 400 -> MALFORMED_REQUEST;
        case 401 -> UNAUTHENTICATED;
        case 403 -> ACCESS_DENIED;
        case 404 -> NOT_FOUND;
        case 405 -> METHOD_NOT_ALLOWED;
        case 406 -> NOT_ACCEPTABLE;
        case 409 -> DATA_CONFLICT;
        case 415 -> UNSUPPORTED_MEDIA_TYPE;
        case 422 -> VALIDATION_FAILED;
        case 429 -> RATE_LIMITED;
        default -> status.is4xxClientError() ? MALFORMED_REQUEST : INTERNAL_ERROR;
        };
    }
}
