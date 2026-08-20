package com.slotflow.availability;

/**
 * Whether an override takes availability away or adds it.
 *
 * <p>Named {@code OverrideType} rather than {@code ExceptionType} (D8): in Java,
 * {@code AvailabilityException} reads as a throwable, and a domain class that looks like an error
 * is a class people will one day try to catch.
 *
 * <p>Precedence is decided in plan 09, not here, and it is worth knowing while reading this enum:
 * <b>{@code BLOCKED} always wins over {@code EXTRA}</b>, whatever the level or the insertion
 * order. A staff member cannot open a business-wide closure with an {@code EXTRA} window.
 */
public enum OverrideType {

    /** Takes availability away. With null times it is a whole day off. */
    BLOCKED,

    /**
     * Adds availability outside the weekly template — a Saturday opening, a late evening. Never
     * whole-day: a whole-day {@code EXTRA} says nothing at all, and the schema rejects it.
     */
    EXTRA
}
