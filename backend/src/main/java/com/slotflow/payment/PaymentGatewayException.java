package com.slotflow.payment;

import com.slotflow.common.error.ApiException;
import com.slotflow.common.error.ErrorCode;

/**
 * Stripe refused, or could not be reached.
 *
 * <p>An {@link ApiException} so it lands in the same problem-detail shape as everything else, with
 * a {@code 502}: the request was fine, a system this one depends on was not, and a client that
 * retries in a minute may well succeed. A {@code 500} would say the bug is here and a {@code 422}
 * would say the customer's request was wrong; both would send whoever is debugging to the wrong
 * place.
 *
 * <p><b>The cause is logged, never rendered.</b> The detail below is a fixed sentence, because a
 * Stripe error message is written for a developer reading a dashboard and can name an account, an
 * API version or a mode. None of that belongs in a response to an anonymous booking page, and a
 * message that changes with the failure is a message somebody will eventually parse.
 */
public class PaymentGatewayException extends ApiException {

    /** What was being attempted, for the log line. Never part of a response. */
    private final String operation;

    public PaymentGatewayException(String operation, Throwable cause) {
        super(ErrorCode.PAYMENT_UNAVAILABLE,
                "Payments are temporarily unavailable. Please try again in a moment.", cause);
        this.operation = operation;
    }

    public String operation() {
        return operation;
    }
}
