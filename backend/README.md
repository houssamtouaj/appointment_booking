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
| `common` | RFC 7807 error handling, pagination, shared JPA plumbing |
| `business` | `Business`, `BookingPolicy` — settings and policy |
| `catalog` | `ServiceOffering`, `StaffService` — what can be booked |
| `staff` | `User` in the OWNER/STAFF roles, invitations |
| `availability` | `WorkingHours`, `AvailabilityOverride`, `AvailabilityEngine` |
| `booking` | `Booking` lifecycle, conflict handling |
| `payment` | Stripe Checkout session + webhook |
| `notification` | Thymeleaf email templates, reminder scheduler |

```
src/main/resources/
├── db/migration/       Flyway versioned SQL (V1__baseline.sql, ...)
└── templates/email/    Thymeleaf HTML email templates
```

Two names differ between the code and the wire, deliberately. The Java types are
`ServiceOffering` and `AvailabilityOverride`; the REST paths stay `/api/services` and
`/api/staff/{id}/exceptions`. A JPA entity called `Service` collides with `@Service` in the
same package, and `AvailabilityException` reads as a throwable.

## Rules this side of the boundary enforces

1. **Never expose entities.** Controllers return DTOs mapped with MapStruct.
2. **Tenant scope comes from the token.** Every admin query filters by the
   `business_id` in the JWT — never from a request parameter. Cross-tenant → `403`.
3. **UTC on the wire and at rest.** `timestamptz` columns, `Instant` in Java;
   timezone conversion happens in the client.
4. **The database is the final arbiter of double booking.** A GiST exclusion
   constraint rejects overlaps for `PENDING`/`CONFIRMED`; the resulting violation
   surfaces as `409 Conflict`.

## Domain model

Entities validate against the Flyway schema on every startup (`ddl-auto: validate`), so a
mapping and its table cannot drift. `SchemaMappingIT` is the acceptance test: the most
important thing it asserts is that the context starts at all.

Conventions that hold for every entity:

| Convention | Why |
|---|---|
| `UUID` ids generated in Java, not by the database | A whole aggregate can be wired up in memory and flushed once |
| `implements Persistable` via `AbstractEntity` | With an assigned id, `save()` would otherwise `merge()` every new row — a wasted `SELECT` and a detached return value |
| `@Enumerated(STRING)` everywhere | Ordinals are a future outage; the round trip is asserted on **raw SQL**, not through JPA |
| Foreign keys as plain `UUID` fields, no `@ManyToOne` | The engine works on ids and ranges; object graphs buy N+1s across a 30-day window and nothing else |
| `Instant` for `timestamptz`; `LocalTime`/`LocalDate`/`DayOfWeek` for recurring rules | "09:00 on Tuesdays" is a wall-clock concept that has to survive a DST change |
| Behaviour on entities, not only getters | The transition matrix, the policy windows and the buffer arithmetic are unit-testable in milliseconds with no Spring context |
| Auditing through the injected `Clock` | `created_at` is as pinnable as everything else, which is what makes the expiry-sweeper tests possible |
| No public setter for `id`, `createdAt` or `status` | Status changes go through guarded transitions; the rest is history |

`@Version` is on `Booking` alone — the one row a scheduled sweeper, a Stripe webhook and a
human can all reach at the same moment.

`StaffService` is an explicit join entity with an `@IdClass`, not a `@ManyToMany`: the
assignment is read from both directions ("what does this person do?" and "who can do this?"),
and cascading a many-to-many is how deleting a service ends up deleting a staff member.

`TenantOwned` is implemented by `Business`, `User`, `ServiceOffering`, `Booking` and
`AvailabilityOverride`. It is the type the tenant guard checks against, so adding a new
tenant-scoped entity cannot mean forgetting to add it to a guard.

## The error contract

Every error response in this API — including a 500 and including one written by a servlet
filter — is `application/problem+json` with the same members:

```json
{
  "type": "https://slotflow.dev/problems/validation-failed",
  "title": "Validation failed",
  "status": 422,
  "detail": "The request contains invalid fields. See errors for the details.",
  "instance": "/api/services",
  "code": "VALIDATION_FAILED",
  "errors": [{ "field": "durationMinutes", "message": "must be less than or equal to 480" }]
}
```

`code` is the stable, machine-readable half and the only part a client should branch on;
every value it can take is declared in `common/error/ErrorCode.java`. `detail` is prose for
humans and may be reworded at any time. `errors[]` appears on `422` responses only.
`requestId` appears on `5xx` responses only, and matches the `X-Request-Id` header that every
response carries and every log line is stamped with.

`ProblemDetailContractTest` asserts that body **strictly** — an added member or a renamed key
fails the build, because the React forms parse these exact keys.

## Pagination

`?page=&size=` with `size` defaulting to 20 and clamped to 100, returning
`{ content, page, size, totalElements, totalPages }`. A raw Spring `Page` is never returned:
its JSON shape is not a published contract and it leaks `pageable`/`sort` internals.

## Rate limiting

In-memory Bucket4j over the unauthenticated endpoints (D12): 10 logins/min per IP,
10 other writes/min per IP under `/api/auth/**` and `/api/public/**`, and 5 bookings/hour
per guest email. Public **reads** are not limited — the booking calendar polls them.

The buckets live in the API process, so the budgets are per instance: a two-container deploy
doubles them. That is the honest trade for a single-instance demo. A multi-instance deploy
swaps the store for `bucket4j-redis` and changes nothing else — `RateLimiter` is the only
class that would need to know.

## Tests

```
mvn verify        # everything; needs Docker running
mvn test          # unit and web-slice tests only, no Docker
```

| Layer | Tool | What lives there |
|---|---|---|
| Pure unit | JUnit 5, no Spring | Entity behaviour, policy windows, buffer arithmetic, the filters |
| Web slice | `@WebMvcTest` | Status codes, the problem-detail contract, pagination |
| Integration | `@SpringBootTest` + Testcontainers | Migrations, the exclusion constraint, the entity-to-schema mapping |

**One Postgres container for the whole integration suite**, started from a static initialiser
in `support/IntegrationTest`. The obvious spelling — `@Testcontainers` plus `@Container` on a
shared base class — starts and stops the container once per *test class*, which turns a
40-second suite into an eight-minute one while still passing. Reuse is on, so it survives
between local runs and is ignored in CI; every test therefore creates its own tenant and
asserts only on rows it inserted.

**Time is always pinned.** `support/MutableClock` is the primary `Clock` for every
integration test, so a test can jump forward thirty-one minutes and watch the expiry sweeper
notice, instead of sleeping. `TestTime.NOW` is Monday 2 March 2026, 09:00 UTC — a Monday
because that is where a weekly template starts, and March because Europe/Paris changes to
summer time a few weeks later. A `Thread.sleep` or a real `now()` in a test is a review
blocker, not a style preference.

**Fixtures are builders**, one static import away:

```java
import static com.slotflow.support.fixtures.Fixtures.*;

Business clinic  = aBusiness().withTimezone("Europe/Paris").withDeposit(30).build();
User      dana   = anOwner().forBusiness(clinic).build();
ServiceOffering massage = aService().forBusiness(clinic)
        .withDuration(60).withBuffers(10, 10).build();
Booking   slot   = aBooking().forService(massage).withStaff(dana).inDays(2).build();
```

Every builder starts from a valid, boring default, so a test that says `withBuffers(10, 10)`
is visibly a test about buffers.

## Built so far

- Maven project on Java 21 / Spring Boot 3.5, Docker Compose stack, multi-stage image
- OpenAPI, CORS, and environment-only configuration — no credential is in the repo
- `V1__baseline.sql`: the whole v1 schema, including the GiST exclusion constraint that
  rejects a booking overlapping another one's buffers (`ExclusionConstraintIT` proves it
  against a real Postgres)
- The cross-cutting layer above: one error shape, `PageResponse`, the injected `Clock` that
  makes every time-dependent test possible, rate limiting and request correlation
- The domain model above: eleven entities, their repositories, and the behaviour the later
  plans call — booking transitions, policy windows, buffer arithmetic, deposit rounding
- The test harness above: one shared container, a movable clock, and fixture builders

## Not built yet

Auth, the availability engine, and every endpoint. `SecurityConfig` currently
permits everything and is replaced when auth lands — which is also when 401 and 403 raised
*inside* the security filter chain start using the problem shape above, via an explicit
`AuthenticationEntryPoint` and `AccessDeniedHandler`. Build order is tracked in the local
project brief (see `docs/`, not committed yet).
