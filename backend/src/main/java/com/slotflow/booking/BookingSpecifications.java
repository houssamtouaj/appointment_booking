package com.slotflow.booking;

import jakarta.persistence.criteria.Predicate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.domain.Specification;

/**
 * The {@code where} clause behind {@code GET /api/bookings}, built one optional filter at a time.
 *
 * <h2>Why a specification and not a JPQL query with null checks</h2>
 * The alternative spelling — {@code (:status is null or b.status = :status)} repeated four times —
 * looks tidier and is a trap. Postgres has to know the type of every parameter it is handed, and a
 * bare {@code ? is null} on an enum or a uuid gives it nothing to infer from, so the query either
 * needs a {@code cast} wart on each line or fails at runtime with "could not determine data type".
 * It also plans worse: one query text covering sixteen filter combinations means one plan for all
 * of them. Here an absent filter contributes no predicate at all.
 *
 * <h2>The tenant predicate is not optional and is not a parameter of the caller</h2>
 * {@link #ofBusiness} is the entry point and it takes the business id first, so there is no way to
 * build one of these without it. That is the shape that makes the cross-tenant guarantee structural:
 * a {@code staffId} filter naming another tenant's staff member is ANDed with a business id that
 * does not match it, and returns an empty page — not a 403, not a leak, and not something the
 * caller had to remember to check.
 */
final class BookingSpecifications {

    private BookingSpecifications() {}

    /**
     * @param from    inclusive lower bound on {@code startsAt}, or null
     * @param to      exclusive upper bound on {@code startsAt}, or null. Exclusive so that two
     *                adjacent day queries neither overlap nor leave a gap, which a {@code between}
     *                cannot manage
     * @param status  one status, or null for every status including the cancelled ones
     * @param staffId one staff member, or null for the whole team
     */
    static Specification<Booking> ofBusiness(UUID businessId, Instant from, Instant to,
            BookingStatus status, UUID staffId) {
        return (root, query, builder) -> {
            List<Predicate> predicates = new ArrayList<>(5);
            predicates.add(builder.equal(root.get("businessId"), businessId));
            if (from != null) {
                predicates.add(builder.greaterThanOrEqualTo(root.get("startsAt"), from));
            }
            if (to != null) {
                predicates.add(builder.lessThan(root.get("startsAt"), to));
            }
            if (status != null) {
                predicates.add(builder.equal(root.get("status"), status));
            }
            if (staffId != null) {
                predicates.add(builder.equal(root.get("staffId"), staffId));
            }
            return builder.and(predicates.toArray(Predicate[]::new));
        };
    }
}
