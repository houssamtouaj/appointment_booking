package com.slotflow.config;

import java.util.Arrays;
import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.aop.interceptor.AsyncUncaughtExceptionHandler;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.AsyncConfigurer;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables the two background mechanisms later plans depend on: {@code @Async} for outbound
 * mail (plan 12) and {@code @Scheduled} for the pending-booking sweeper (D3) and the
 * reminder job. The pool itself is Boot's auto-configured {@code applicationTaskExecutor},
 * sized under {@code spring.task.execution} so it stays visible in configuration.
 *
 * <h2>The handler is the whole reason this class has a body</h2>
 * A {@code void @Async} method has nobody to throw to. Spring calls it on a worker thread, the
 * caller already has its {@code null} back, and without an {@link AsyncUncaughtExceptionHandler}
 * the default implementation logs at {@code ERROR} through Spring's own logger with no idea what
 * the arguments meant. That is survivable for one job and indefensible for outbound mail: every
 * bounced SMTP handshake in this application happens on one of these threads, and "the customer
 * never got the confirmation" must not be a thing you find out from the customer.
 *
 * <p>So the handler is ours, and it logs the arguments. A booking notification carries the booking
 * id and the recipient's address in its parameters, which turns an invisible failure into a line
 * you can grep by booking id — the same identifier {@code PublicBookingService} already logs when
 * the row was created, so the two ends of the story join up.
 *
 * <p>{@link #getAsyncExecutor()} returns {@code null} deliberately: that is the documented way to
 * tell {@link AsyncConfigurer} "keep looking", so the executor stays Boot's auto-configured
 * {@code applicationTaskExecutor} and its bounds stay in {@code application.yml} rather than being
 * reimplemented here where nobody would think to look for them.
 */
@Configuration
@EnableAsync
@EnableScheduling
public class AsyncConfig implements AsyncConfigurer {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    /** Null means "use the container's own executor" — see the class note. */
    @Override
    public Executor getAsyncExecutor() {
        return null;
    }

    @Override
    public AsyncUncaughtExceptionHandler getAsyncUncaughtExceptionHandler() {
        return (throwable, method, params) -> log.error(
                "Async {}.{} failed for {} - nobody was notified",
                method.getDeclaringClass().getSimpleName(), method.getName(),
                describe(params), throwable);
    }

    /**
     * The arguments, rendered short.
     *
     * <p>Types only, never values. {@code Arrays.toString} on a {@code BookingNotification} would
     * print a customer's name, address and phone number into a log line that is kept for months and
     * shipped to whatever aggregator the deploy uses. The point of this handler is to say which
     * send died, and the method name plus the shape of its arguments does that.
     */
    private static String describe(Object... params) {
        return params.length == 0
                ? "no arguments"
                : Arrays.stream(params)
                        .map(AsyncConfig::describeArgument)
                        .reduce((a, b) -> a + ", " + b)
                        .orElseThrow();
    }

    private static String describeArgument(Object argument) {
        return argument == null ? "null" : argument.getClass().getSimpleName();
    }
}
