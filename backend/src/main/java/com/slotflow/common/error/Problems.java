package com.slotflow.common.error;

import com.slotflow.common.web.RequestCorrelation;
import java.net.URI;
import java.util.Comparator;
import java.util.List;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;

/**
 * Builds the one error body this API has.
 *
 * <p>Two very different callers need it: {@link GlobalExceptionHandler}, for anything thrown
 * inside a controller, and the servlet filters, which run before the dispatcher and therefore
 * before any {@code @ControllerAdvice} exists. Plan 05's {@code AuthenticationEntryPoint} and
 * {@code AccessDeniedHandler} are the third. Sharing this factory is what stops the contract
 * quietly forking into two shapes.
 */
public final class Problems {

    /** Members beyond RFC 7807's own, all of them part of the published contract. */
    public static final String CODE_PROPERTY = "code";
    public static final String ERRORS_PROPERTY = "errors";
    public static final String REQUEST_ID_PROPERTY = "requestId";

    /**
     * The {@code detail} on every {@code 422}, shared rather than repeated because two very
     * different producers emit it: the MVC binder's own failures, handled in
     * {@link GlobalExceptionHandler}, and a service that rejects a field the binder cannot check —
     * an unknown IANA zone id, for instance. A client that keys off {@code detail} instead of
     * {@code code} is already doing the wrong thing, but it should at least not see two spellings
     * of the same sentence.
     */
    public static final String VALIDATION_DETAIL =
            "The request contains invalid fields. See errors for the details.";

    private Problems() {
    }

    public static ProblemDetail of(ErrorCode code, String detail) {
        return of(code, code.status(), detail);
    }

    /**
     * The status is passed separately because a handful of call sites legitimately override
     * the code's default — the same {@code VALIDATION_FAILED} shape is a 422 from a request
     * body and a 400 from an unparseable query parameter.
     */
    public static ProblemDetail of(ErrorCode code, HttpStatusCode status, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail);
        problem.setType(code.type());
        problem.setTitle(code.title());
        problem.setProperty(CODE_PROPERTY, code.name());
        // Only on 5xx: a server fault is the case where a caller needs something to quote
        // back to us, and keeping 4xx bodies free of per-request noise keeps them assertable
        // byte for byte in a test. The X-Request-Id header is present either way.
        if (status.is5xxServerError()) {
            problem.setProperty(REQUEST_ID_PROPERTY, RequestCorrelation.current());
        }
        return problem;
    }

    /**
     * Null-tolerant on both members, and that is not defensive padding. A
     * {@code MessageSourceResolvable} may carry no default message, and a controller parameter has
     * no name unless the class was compiled with {@code -parameters}. A bare
     * {@code Comparator.comparing} throws on either — from inside the {@code @ExceptionHandler}
     * that called it, so the caller gets Boot's fallback error page instead of the 422 this class
     * exists to guarantee.
     */
    private static final Comparator<ValidationError> BY_FIELD_THEN_MESSAGE =
            Comparator.comparing(ValidationError::field,
                            Comparator.nullsFirst(Comparator.<String>naturalOrder()))
                    .thenComparing(ValidationError::message,
                            Comparator.nullsFirst(Comparator.<String>naturalOrder()));

    /**
     * Sorted, because Hibernate Validator reports violations in an unspecified order and an
     * unsorted {@code errors[]} makes the contract test flake roughly one run in two.
     */
    public static void addValidationErrors(ProblemDetail problem, List<ValidationError> errors) {
        problem.setProperty(ERRORS_PROPERTY, errors.stream()
                .sorted(BY_FIELD_THEN_MESSAGE)
                .toList());
    }

    public static void setInstance(ProblemDetail problem, String requestUri) {
        if (requestUri != null && !requestUri.isBlank()) {
            problem.setInstance(URI.create(requestUri));
        }
    }
}
