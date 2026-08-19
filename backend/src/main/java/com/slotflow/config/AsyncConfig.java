package com.slotflow.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Enables the two background mechanisms later plans depend on: {@code @Async} for outbound
 * mail (plan 12) and {@code @Scheduled} for the pending-booking sweeper (D3) and the
 * reminder job. The pool itself is Boot's auto-configured {@code applicationTaskExecutor},
 * sized under {@code spring.task.execution} so it stays visible in configuration.
 */
@Configuration
@EnableAsync
@EnableScheduling
public class AsyncConfig {
}
