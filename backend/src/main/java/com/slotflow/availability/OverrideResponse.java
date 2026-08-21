package com.slotflow.availability;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.UUID;

/**
 * An override, as the admin calendar reads it.
 *
 * <p>Two of the members restate what an absent field already implies, on purpose. Jackson omits nulls
 * (a deliberate convention, so an optional field the server has nothing to say about does not appear
 * at all), which means "whole day" reaches the client as the <em>absence</em> of {@code startTime}
 * and "business-wide" as the absence of {@code staffId}. Inferring a meaning from a missing key is
 * exactly the reasoning that breaks the first time a serialisation setting changes, and both facts
 * drive what the calendar draws — a closure bar across every column, or a strip in one.
 *
 * @param staffId     absent for a business-wide row (D5), which applies to everybody in the tenant
 *                    now and to whoever joins later
 * @param businessWide the same fact, said out loud
 * @param wholeDay     likewise: true when there are no times, which for a {@code BLOCKED} row is a
 *                     day off
 */
public record OverrideResponse(
        UUID id,
        UUID staffId,
        boolean businessWide,
        LocalDate date,
        LocalTime startTime,
        LocalTime endTime,
        boolean wholeDay,
        OverrideType type,
        String reason) {
}
