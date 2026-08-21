package com.slotflow.common.error;

import com.slotflow.common.web.RequestCorrelation;
import jakarta.persistence.EntityNotFoundException;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.MethodParameter;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.ServletWebRequest;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

/**
 * Every error this API returns is shaped here.
 *
 * <p>Extending {@link ResponseEntityExceptionHandler} matters: it already catches the twenty
 * or so exceptions Spring MVC raises before a controller is reached, and routing them through
 * {@link #handleExceptionInternal} means an unsupported media type comes back in the same
 * envelope as a booking conflict. Handling only our own exceptions would leave Boot's default
 * body reachable, and then the contract has two shapes.
 *
 * <p><b>What this class cannot see:</b> Spring Security's filter chain runs before the
 * dispatcher, so a 401 or 403 raised inside it never arrives here. Plan 05 wires an
 * {@code AuthenticationEntryPoint} and an {@code AccessDeniedHandler} onto
 * {@link ProblemDetailWriter} for exactly that reason. The handlers below cover the other
 * path: a method-security check inside a controller or service, which does throw into the
 * dispatcher.
 */
@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /**
     * Anything the application threw on purpose. The code, the status and any extra members
     * all come off the exception, so adding an error case later is a new {@link ErrorCode}
     * constant and a throw, not another handler method.
     */
    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Object> handleApiException(ApiException ex, WebRequest request) {
        ProblemDetail problem = Problems.of(ex.code(), ex.status(), ex.detail());
        ex.properties().forEach(problem::setProperty);
        return handleExceptionInternal(ex, problem, new HttpHeaders(), ex.status(), request);
    }

    /**
     * Also the answer for a cross-tenant read: plan 06's tenant guard throws this rather than
     * {@link AccessDeniedException} so the API never confirms that a foreign id exists.
     */
    @ExceptionHandler(EntityNotFoundException.class)
    public ResponseEntity<Object> handleNotFound(EntityNotFoundException ex, WebRequest request) {
        return problem(ex, ErrorCode.NOT_FOUND, "The requested resource does not exist.", request);
    }

    /** Cross-tenant writes and role checks that fail inside a method, not in the filter chain. */
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Object> handleAccessDenied(AccessDeniedException ex, WebRequest request) {
        return problem(ex, ErrorCode.ACCESS_DENIED,
                "You do not have permission to perform this action.", request);
    }

    /**
     * Deliberately identical for a wrong password, an unknown email and a disabled account: a
     * distinguishable message here is an account-enumeration oracle.
     */
    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Object> handleAuthentication(AuthenticationException ex, WebRequest request) {
        return problem(ex, ErrorCode.UNAUTHENTICATED, "Invalid credentials.", request);
    }

    /** A bean-validated service call or query parameter, validated outside the MVC binder. */
    @ExceptionHandler(ConstraintViolationException.class)
    public ResponseEntity<Object> handleConstraintViolation(
            ConstraintViolationException ex, WebRequest request) {
        ProblemDetail problem = Problems.of(ErrorCode.VALIDATION_FAILED, Problems.VALIDATION_DETAIL);
        Problems.addValidationErrors(problem, ex.getConstraintViolations().stream()
                .map(violation -> new ValidationError(leafPath(violation), violation.getMessage()))
                .toList());
        return handleExceptionInternal(ex, problem, new HttpHeaders(),
                ErrorCode.VALIDATION_FAILED.status(), request);
    }

    /**
     * A constraint that application code did not catch first. It is mapped rather than left to
     * fall through to a 500 because the honest answer is "your request conflicts with existing
     * data", but the detail is deliberately generic: the raw message names tables, columns and
     * constraint names. Plan 10 catches the booking overlap earlier and far more precisely, by
     * SQLState.
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<Object> handleDataIntegrityViolation(
            DataIntegrityViolationException ex, WebRequest request) {
        log.warn("Unmapped data integrity violation on {}", pathOf(request), ex);
        return problem(ex, ErrorCode.DATA_CONFLICT,
                "The request conflicts with the current state of the data.", request);
    }

    /** Two writers raced on a versioned row. Retrying the request is the correct client action. */
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<Object> handleOptimisticLocking(
            OptimisticLockingFailureException ex, WebRequest request) {
        return problem(ex, ErrorCode.DATA_CONFLICT,
                "This record was modified by someone else. Reload it and try again.", request);
    }

    /**
     * The backstop. It logs at error with the correlation id and returns a body with no
     * exception class, no message and no stack trace: the internals of a 500 are for the log,
     * not for the caller.
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Object> handleUnexpected(Exception ex, WebRequest request) {
        log.error("Unhandled exception on {}", pathOf(request), ex);
        return problem(ex, ErrorCode.INTERNAL_ERROR,
                "Something went wrong on our side. Quote the request id if you report this.",
                request);
    }

    // ---------------------------------------------------------------------------------
    //  Spring MVC's own exceptions
    // ---------------------------------------------------------------------------------

    /**
     * A failed request body, and the single most important body in this class: it is what the
     * React forms parse to put a message under an input. Note the status. Spring's default for
     * this exception is 400; the contract in brief section 6 says 422.
     */
    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail problem = Problems.of(ErrorCode.VALIDATION_FAILED, Problems.VALIDATION_DETAIL);
        Problems.addValidationErrors(problem, ex.getBindingResult().getAllErrors().stream()
                .map(GlobalExceptionHandler::toValidationError)
                .toList());
        return handleExceptionInternal(ex, problem, headers,
                ErrorCode.VALIDATION_FAILED.status(), request);
    }

    /**
     * A required query parameter that was not sent.
     *
     * <p>Without this override the answer is {@code 400 MALFORMED_REQUEST} — the generic code
     * {@link ErrorCode#forStatus} hands to any 400 — which is the same answer as unparseable JSON
     * and an unknown property. {@link ErrorCode#MISSING_PARAMETER} was declared in plan 04 for
     * exactly this case and had no way of ever being returned; the first endpoint with a required
     * parameter ({@code GET /api/exceptions?from=&to=}) is what made that visible. The distinction
     * is worth the eight lines: "you forgot {@code from}" and "your body is not JSON" are different
     * mistakes with different fixes, and only one of them is worth re-reading the payload over.
     *
     * <p>The parameter is named in {@code detail} rather than in {@code errors[]}, because that
     * array is a 422 member — it is what the React forms parse to attach a message to an input, and
     * a missing query parameter is a bug in the caller rather than something a user typed.
     */
    @Override
    protected ResponseEntity<Object> handleMissingServletRequestParameter(
            MissingServletRequestParameterException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail problem = Problems.of(ErrorCode.MISSING_PARAMETER, status,
                "The required parameter \"%s\" is missing.".formatted(ex.getParameterName()));
        return handleExceptionInternal(ex, problem, headers, status, request);
    }

    /**
     * Spring 6.1 raises this instead of {@link ConstraintViolationException} when validation
     * fails on a controller method's own parameters. Without this override those come back as
     * a 500.
     */
    @Override
    protected ResponseEntity<Object> handleHandlerMethodValidationException(
            HandlerMethodValidationException ex, HttpHeaders headers,
            HttpStatusCode status, WebRequest request) {
        ProblemDetail problem = Problems.of(ErrorCode.VALIDATION_FAILED, Problems.VALIDATION_DETAIL);
        Problems.addValidationErrors(problem, ex.getAllValidationResults().stream()
                .flatMap(result -> result.getResolvableErrors().stream()
                        .map(error -> new ValidationError(
                                parameterName(result.getMethodParameter()),
                                error.getDefaultMessage())))
                .toList());
        return handleExceptionInternal(ex, problem, headers,
                ErrorCode.VALIDATION_FAILED.status(), request);
    }

    /**
     * The single funnel every response in this class passes through, including the ones
     * {@link ResponseEntityExceptionHandler} builds for us. Anything Spring produced arrives
     * here with a bare {@code ProblemDetail} (no {@code code}, no {@code type}) and gets the
     * missing members stamped on, which is what makes "every error response carries a code"
     * true rather than aspirational.
     */
    @Override
    protected ResponseEntity<Object> handleExceptionInternal(
            Exception ex, Object body, HttpHeaders headers,
            HttpStatusCode statusCode, WebRequest request) {
        ProblemDetail problem = body instanceof ProblemDetail detail
                ? detail
                : Problems.of(ErrorCode.forStatus(statusCode), statusCode, defaultDetail(statusCode));
        if (problem.getProperties() == null
                || !problem.getProperties().containsKey(Problems.CODE_PROPERTY)) {
            ErrorCode code = ErrorCode.forStatus(statusCode);
            problem.setType(code.type());
            problem.setTitle(code.title());
            problem.setProperty(Problems.CODE_PROPERTY, code.name());
            if (statusCode.is5xxServerError()) {
                problem.setProperty(Problems.REQUEST_ID_PROPERTY, RequestCorrelation.current());
            }
        }
        Problems.setInstance(problem, pathOf(request));
        return super.handleExceptionInternal(ex, problem, headers, statusCode, request);
    }

    // ---------------------------------------------------------------------------------
    //  helpers
    // ---------------------------------------------------------------------------------

    private ResponseEntity<Object> problem(
            Exception ex, ErrorCode code, String detail, WebRequest request) {
        return handleExceptionInternal(
                ex, Problems.of(code, detail), new HttpHeaders(), code.status(), request);
    }

    private static ValidationError toValidationError(ObjectError error) {
        String field = error instanceof FieldError fieldError
                ? fieldError.getField()
                : error.getObjectName();
        return new ValidationError(field, error.getDefaultMessage());
    }

    /**
     * {@code getParameterName()} is null unless the class was compiled with {@code -parameters}
     * (pom.xml supplies it today, and one build-config edit would take it away). A null field is
     * dropped from the body altogether by {@code NON_NULL} inclusion, leaving the React forms a
     * message with nothing to attach it to. {@code arg0} is at least Spring's own spelling for an
     * unnamed parameter, and it is positional.
     */
    private static String parameterName(MethodParameter parameter) {
        String name = parameter.getParameterName();
        return name != null ? name : "arg" + parameter.getParameterIndex();
    }

    /** {@code create.request.durationMinutes} is noise; the client only knows the leaf name. */
    private static String leafPath(ConstraintViolation<?> violation) {
        String path = violation.getPropertyPath().toString();
        int lastDot = path.lastIndexOf('.');
        return lastDot >= 0 ? path.substring(lastDot + 1) : path;
    }

    private static String pathOf(WebRequest request) {
        return request instanceof ServletWebRequest servletRequest
                ? servletRequest.getRequest().getRequestURI()
                : null;
    }

    private static String defaultDetail(HttpStatusCode statusCode) {
        HttpStatus resolved = HttpStatus.resolve(statusCode.value());
        return resolved == null ? "Request failed." : resolved.getReasonPhrase() + ".";
    }
}
