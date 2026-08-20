package com.slotflow.common.error;

import java.util.LinkedHashMap;
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

    private final ErrorCode code;
    private final HttpStatus status;
    private final Map<String, Object> properties = new LinkedHashMap<>();

    /** Uses the status the code declares, which is the right choice almost every time. */
    public ApiException(ErrorCode code, String detail) {
        this(code, code.status(), detail);
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

    /** Fluent because these are almost always added at the throw site. */
    public ApiException with(String name, Object value) {
        properties.put(name, value);
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
