# SlotFlow — Backend

Spring Boot 3 / Java 21 REST API. Owns the entire domain: tenancy, availability,
bookings, payments and notifications. It has no knowledge of the React client
beyond the HTTP contract it publishes via OpenAPI.

## Package layout

`com.slotflow.*` — packaged by feature, not by technical layer, so each package
holds its own controller, service, repository, entity and DTOs.

| Package | Responsibility |
|---|---|
| `config` | Spring configuration, OpenAPI, CORS, Jackson, scheduling |
| `security` | JWT issue/verify, refresh-token rotation, method security |
| `tenant` | Resolves `business_id` from the JWT and enforces isolation |
| `common` | RFC 7807 error handling, pagination, shared value objects |
| `business` | `Business`, `BookingPolicy` — settings and policy |
| `catalog` | `Service`, `StaffService` — what can be booked |
| `staff` | `User` in the OWNER/STAFF roles, invitations |
| `availability` | `WorkingHours`, `AvailabilityException`, `AvailabilityEngine` |
| `booking` | `Booking` lifecycle, conflict handling |
| `payment` | Stripe Checkout session + webhook |
| `notification` | Thymeleaf email templates, reminder scheduler |

```
src/main/resources/
├── db/migration/       Flyway versioned SQL (V1__baseline.sql, ...)
└── templates/email/    Thymeleaf HTML email templates
```

## Rules this side of the boundary enforces

1. **Never expose entities.** Controllers return DTOs mapped with MapStruct.
2. **Tenant scope comes from the token.** Every admin query filters by the
   `business_id` in the JWT — never from a request parameter. Cross-tenant → `403`.
3. **UTC on the wire and at rest.** `timestamptz` columns, `Instant` in Java;
   timezone conversion happens in the client.
4. **The database is the final arbiter of double booking.** A GiST exclusion
   constraint rejects overlaps for `PENDING`/`CONFIRMED`; the resulting violation
   surfaces as `409 Conflict`.

## Not built yet

Maven project, entities, migrations, and the availability engine.
Build order is tracked in the local project brief (see `docs/`, not committed yet).
