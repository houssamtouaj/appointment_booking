package com.slotflow.common.web;

import java.util.UUID;
import org.slf4j.MDC;

/**
 * The request id every log line and every 5xx body is stamped with.
 *
 * <p>Cheap infrastructure with a disproportionate payoff: when the deployed demo returns a
 * 500, the response carries the same token that the log line does, so "it broke at 14:03"
 * becomes one grep instead of a guess.
 */
public final class RequestCorrelation {

    /** Read from the caller if present, always echoed back. */
    public static final String HEADER = "X-Request-Id";

    /** MDC key; {@code logging.pattern.correlation} in application.yml prints it. */
    public static final String MDC_KEY = "requestId";

    /**
     * An inbound id is echoed rather than replaced so a request can be traced across the SPA
     * and the API, but only if it is short and boring: it lands in log files and in a response
     * header, and an attacker-supplied newline there is log injection.
     */
    private static final int MAX_LENGTH = 64;

    private RequestCorrelation() {}

    /** The current request's id, or {@code null} outside a request (a scheduled job). */
    public static String current() {
        return MDC.get(MDC_KEY);
    }

    static String sanitiseOrGenerate(String candidate) {
        if (candidate == null || candidate.isBlank() || candidate.length() > MAX_LENGTH
                || !candidate.chars().allMatch(RequestCorrelation::isSafe)) {
            return UUID.randomUUID().toString();
        }
        return candidate;
    }

    private static boolean isSafe(int ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
                || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_';
    }

    static void bind(String requestId) {
        MDC.put(MDC_KEY, requestId);
    }

    static void unbind() {
        MDC.remove(MDC_KEY);
    }
}
