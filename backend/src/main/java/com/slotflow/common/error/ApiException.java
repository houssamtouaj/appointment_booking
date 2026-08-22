package com.slotflow.common.error;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;

/**
 * The base of every deliberate error this API raises.
 *
 * <p>Carrying the {@link ErrorCode} on the exception is what keeps the handler dumb: it does
 * not need a growing {@code instanceof} chain to know a status, a title and a machine code —
 * it reads them off whatever was thrown. Subclass this only when a call site needs to carry
 * extra data or be caught by type (plan 10's booking conflict does both); otherwise throw it
 * directly.
 *
 * <p>{@link #properties()} become extra members of the problem body. Use them for anything a
 * client would otherwise have to parse out of {@code detail} — a cancellation deadline, the
 * slot that was taken — never for anything sensitive: this map is serialised to the caller.
 */
public class ApiException extends RuntimeException {

    /**
     * The one property with a meaning beyond the body: {@link GlobalExceptionHandler} copies it to
     * the {@code Retry-After} header as well.
     *
     * <p>{@code RateLimitFilter} sets that header on the 429s it produces, and D12's per-email
     * booking budget is enforced in a service rather than in a filter — the key is in the parsed
     * request body — so without this the same status code would come back with the header from one
     * producer and without it from the other. A client that backs off correctly against one and
     * hammers the other is a contract with a seam in it.
     */
    public static final String RETRY_AFTER_SECONDS = "retryAfterSeconds";

    private final ErrorCode code;
    private final HttpStatus status;
    private final Map<String, Object> properties = new LinkedHashMap<>();

    /** Uses the status the code declares, which is the right choice almost every time. */
    public ApiException(ErrorCode code, String detail) {
        this(code, code.status(), detail);
    }

    /**
     * A 422 in exactly the shape the MVC binder produces, {@code errors[]} included, for a field
     * bean validation cannot check on its own.
     *
     * <p>There are several: an IANA zone id and an ISO 4217 code are "well-formed but unknown", and
     * a working-hours range is only invalid relative to the other ranges in the same request. All of
     * them are still one field being wrong, and a React form has to be able to attach the message to
     * an input whichever layer noticed — so the body must not depend on where the check happened to
     * live. Declared here rather than copied into each service, because the third copy is where the
     * shapes start to differ.
     *
     * @param field the request-body path the client knows the value by: {@code timezone},
     *              {@code ranges[2].endTime}
     */
    public static ApiException invalidField(String field, String message) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, Problems.VALIDATION_DETAIL)
                .with(Problems.ERRORS_PROPERTY, List.of(new ValidationError(field, message)));
    }

    public ApiException(ErrorCode code, HttpStatus status, String detail) {
        super(detail);
        this.code = code;
        this.status = status;
    }

    public ApiException(ErrorCode code, String detail, Throwable cause) {
        super(detail, cause);
        this.code = code;
        this.status = code.status();
    }

    public ErrorCode code() {
        return code;
    }

    public HttpStatus status() {
        return status;
    }

    /**
     * Fluent because these are almost always added at the throw site.
     *
     * <p>A null value is dropped rather than stored, and that is load-bearing rather than tidy.
     * {@link #properties()} hands back a {@code Map.copyOf}, which throws on a null value — from
     * inside the {@code @ExceptionHandler} that called it, where a thrown exception is logged at
     * warn and the <em>original</em> exception is left to escape as a 500. So a single optional
     * member, absent for a perfectly ordinary request, turns a considered 409 into a server error
     * that names neither the field nor the endpoint. {@code NON_NULL} serialisation would have
     * dropped the member anyway; this drops it one step earlier, where it cannot detonate.
     */
    public ApiException with(String name, Object value) {
        if (value != null) {
            properties.put(name, value);
        }
        return this;
    }

    public Map<String, Object> properties() {
        return Map.copyOf(properties);
    }

    /** The human-readable half of the body. Never null: the constructors all require it. */
    public String detail() {
        return getMessage();
    }
}
