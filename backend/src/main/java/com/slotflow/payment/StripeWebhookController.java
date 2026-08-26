package com.slotflow.payment;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Where Stripe tells us the money arrived.
 *
 * <h2>{@code @RequestBody String}, and it has to be</h2>
 * The signature is an HMAC over the <em>exact bytes</em> Stripe sent. Binding a DTO here would hand
 * Jackson the stream, and by the time a verification could run the original bytes are gone — every
 * signature would fail, or, worse, somebody would "fix" it by re-serialising the DTO and verifying
 * a signature over a payload Stripe never sent. Taking the raw string is the whole reason this
 * controller has no request model.
 *
 * <h2>Unauthenticated, and not unprotected</h2>
 * There is no token on this path — Stripe has none to present — so the signature <em>is</em> the
 * authentication. {@code SecurityConfig} lists the path as public and CSRF is disabled chain-wide
 * (no session, no cookie on this path), which together mean the only thing standing between this
 * endpoint and anybody who can send it a POST is {@code STRIPE_WEBHOOK_SECRET}. The rate limiter
 * deliberately does not cover it: throttling Stripe's retries would turn a burst into a backlog.
 *
 * <h2>200 unless the signature is wrong</h2>
 * Stripe reads a non-2xx as "try again", for up to three days. So a {@code 200} is the answer to
 * every event this application understood and every event it chose to ignore, and the two failures
 * that are not {@code 200} are deliberate: a bad signature is a {@code 400} because retrying will
 * not fix it, and an unfinished unit of work is a {@code 5xx} because retrying is exactly what
 * should happen — see {@link StripeWebhookService} for why nothing can be half-applied.
 */
@RestController
@Tag(name = "Webhooks", description = "Signature-verified callbacks from payment providers")
@SecurityRequirements
public class StripeWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookController.class);

    private final StripeWebhookService webhooks;

    public StripeWebhookController(StripeWebhookService webhooks) {
        this.webhooks = webhooks;
    }

    @PostMapping("/api/webhooks/stripe")
    @ResponseStatus(HttpStatus.OK)
    @Operation(summary = "Stripe events",
            description = """
                    Called by Stripe, never by a client. Every request is authenticated by the \
                    Stripe-Signature header against STRIPE_WEBHOOK_SECRET; an invalid or missing \
                    signature is a 400 and nothing is read.

                    checkout.session.completed confirms the booking and records what was paid. \
                    checkout.session.expired cancels it and frees the slot. Every other event type \
                    is recorded as seen and ignored.

                    Safe to deliver twice: the event id is persisted, and the state changes are \
                    themselves one-way (PENDING to CONFIRMED, PENDING to CANCELLED). A replay \
                    answers 200 and changes nothing.""")
    public void receive(@RequestBody String payload,
                        @RequestHeader(name = "Stripe-Signature", required = false)
                        String signature) {
        webhooks.handle(payload, signature);
    }

    /**
     * Two deliveries of one event raced, and this one lost the insert.
     *
     * <p>Answered {@code 200} rather than allowed to become a 500, because from Stripe's point of
     * view the event has been accepted — the winning transaction is applying it right now. A 500
     * here would schedule a retry of an event that is already done, which is how a race turns into
     * three days of noise.
     *
     * <p>Declared on the controller rather than in {@code GlobalExceptionHandler}: it is a fact
     * about this one endpoint's protocol with one sender, and the global advice has no business
     * knowing that some exceptions mean success.
     */
    @ExceptionHandler(StripeWebhookService.DuplicateEventException.class)
    @ResponseStatus(HttpStatus.OK)
    public void alreadyApplied(StripeWebhookService.DuplicateEventException duplicate) {
        log.info("{}; answering 200 so Stripe does not retry it", duplicate.getMessage());
    }
}
