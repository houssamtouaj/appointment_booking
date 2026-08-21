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
   `business_id` in the JWT — never from a request parameter. A cross-tenant **read**
   is `404`, a cross-tenant **write** is `403`; see [Tenant isolation](#tenant-isolation)
   for why the two differ.
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
| `implements Persistable` via `AbstractAuditedEntity` | With an assigned id, `save()` would otherwise `merge()` every new row — a wasted `SELECT` and a detached return value |
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

`TenantOwned` is implemented by `Business`, `User`, `ServiceOffering`, `Booking`,
`AvailabilityOverride` and `BookingPolicy`. It is the type the tenant guard checks against, so
adding a new tenant-scoped entity cannot mean forgetting to add it to a guard.

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

## Auth

### Tokens

| Token | Lifetime | Where it lives | How it is stored |
|---|---|---|---|
| Access | 15 min | client memory only | not stored — it is a signed JWT |
| Refresh | 7 days | httpOnly cookie, `Path=/api/auth` | SHA-256 hash in `refresh_token` |
| Password reset | 1 h, single use | emailed link | SHA-256 hash in `password_reset_token` |
| Invitation | 7 days, single use | emailed link | SHA-256 hash in `staff_invitation` |

The access token is HS256 with a `JWT_SECRET` of at least 32 bytes, read from the
environment; the application refuses to start without one rather than 500ing on the first
login. Its claims are `sub` (user id), **`bid` (business id — the tenant boundary)**, `role`,
`iat`, `exp` and `jti`.

Nothing in the API revokes an access token, and that is the design rather than an omission:
a valid signature is a valid request, with no database round trip. The cost is a window —
a deactivated user, or one whose role just changed, keeps their old rights until the token
expires. Fifteen minutes bounds it, `/api/auth/refresh` is where the change lands, and
`logout` says so explicitly: the refresh token dies immediately, the access token has up to
fifteen minutes left. The token is also the *only* source of role and tenant for a request.
Reading either back from the database on some paths and not others is how two parts of one
codebase come to disagree about who is calling.

### Refresh rotation with reuse detection

Every refresh revokes the presented token, issues a successor, and links the two through
`replaced_by`. A refresh token is therefore usable exactly once, and the chain is a session's
history.

"Exactly once" is a claim about simultaneous callers, so the lookup takes a row lock
(`SELECT … FOR UPDATE`) rather than reading and then writing. Without it two overlapping
refreshes of the same value both see `revoked_at IS NULL` and both mint a successor: the hashes
differ, so no unique index objects, `replaced_by` names one of them, and the other is a live
seven-day session with no theft signal attached. With it the second caller waits, re-reads a
revoked row, and gets the `REFRESH_REUSED` answer it should have got. `RefreshRotationIT`
races four callers over one token, because a sequential replay cannot tell the two
implementations apart.

That chain is what makes theft visible. A token that is already revoked can only be presented
by someone holding a copy — the legitimate client rotated and discarded it. So a replay is not
a plain 401: it revokes **every live token for that user** and returns `401 REFRESH_REUSED`.
An attacker who steals a refresh token gets one use of it, and the next refresh by either
party logs both out. The victim notices, which is the point.

The revocation runs in its own transaction (`REQUIRES_NEW`) precisely because the exception
that reports it would otherwise roll it back — the API would answer "this session has been
ended" and end nothing, and every status-code assertion would still pass. `RefreshRotationIT`
asserts the chain state in SQL for that reason, not through the API's own answers.

### Housekeeping: the expired-token sweep

`refresh_token` gains a row on every login **and** every rotation — one every fifteen minutes
per signed-in tab — and nothing else ever deletes one. `ExpiredTokenSweeper` runs daily
off-peak (`TOKEN_SWEEP_CRON`, `-` to disable) and deletes refresh and reset tokens whose
`expires_at` has passed. Both queries are one bulk statement against an indexed predicate.

**Expired, never revoked.** A revoked token still inside its seven days is exactly what reuse
detection reads: presenting it has to produce `401 REFRESH_REUSED` and revoke the chain, and
that answer exists only while the row does. Deleting revoked rows would turn a replay into an
unknown token — no theft signal, no chain revocation — which is a security regression wearing
housekeeping's clothes. `ExpiredTokenSweepIT` asserts both halves. The suite disables the
schedule and calls the sweeper directly: it deletes rows, the tests move the clock forward by
days, and otherwise which test lost its fixture would depend on the time of day the build ran.

### Refresh-token transport — the decision

**httpOnly cookie, `SameSite=Lax`, `Path=/api/auth`, `Secure` in every deployed environment.
The access token lives in the SPA's memory and is never persisted.**

- `HttpOnly` is the whole reason: an XSS bug cannot exfiltrate a seven-day credential. A
  refresh token in a JSON body reaches `localStorage` in every codebase that has tried it,
  whatever the README says.
- `SameSite=Lax` plus the path scope is the CSRF answer. A cross-site `POST` does not carry a
  Lax cookie, and the two endpoints that read one are the only ones that accept a cookie for
  anything — everything else authorises on the `Authorization` header. That is why
  `csrf()` is disabled: a conclusion, not an oversight.
- Consequences the frontend plans depend on: CORS sends `allowCredentials`, so the origin list
  can never be a wildcard, and the SPA's Axios instance needs `withCredentials: true`. Its
  interceptor retries a 401 once against `POST /api/auth/refresh` with no body.
- `/refresh` and `/logout` also accept `{"refreshToken": "..."}` in the body. That is not a
  second browser transport — it is how a non-browser client, Swagger UI or a test presents a
  *specific* token, which is the only way to demonstrate reuse detection at all, since a
  browser has by then thrown the old value away. The raw value is visible to a human in the
  `Set-Cookie` response header.

### The filter chain

Stateless sessions, BCrypt (strength from configuration: 12 in production, 4 in the suite —
BCrypt is deliberately slow and a suite that signs in a hundred times should not pay for it),
and an enumerated public allowlist:

```
/api/auth/register  /api/auth/login  /api/auth/refresh  /api/auth/logout
/api/auth/forgot-password  /api/auth/reset-password
/api/public/**  /api/webhooks/stripe
/swagger-ui/**  /v3/api-docs/**  /actuator/health
```

Enumerated, not `/api/auth/**`: `/me` needs a caller, and a prefix rule would leave it
anonymous while still *looking* correct. Everything else is `authenticated()`, and roles are
checked by `@PreAuthorize` next to the method they guard rather than by a second list of URL
patterns here — "OWNER, or STAFF acting on themselves" is a sentence no URL pattern can
express.

**`logout` is on the list, and that is deliberate.** Behind `authenticated()`, sign-out stops
working exactly when it is needed: fifteen minutes into a forgotten tab the access token is
gone, the client still holds a seven-day refresh cookie, and `POST /logout` answers 401 without
the controller ever running — so the credential that actually matters cannot be revoked by the
client holding it. The refresh token in the request *is* the proof of possession: 256 bits,
single use, looked up by hash. Requiring a second credential in order to give up the first buys
nothing and costs the SPA a refresh-then-logout dance on every sign-out path. Writes under
`/api/auth/` stay inside the rate limiter either way.

`401` and `403` raised **inside** the chain go through an explicit `AuthenticationEntryPoint`
and `AccessDeniedHandler` onto the same `Problems` factory as everything else. Without them,
the two errors Spring Security writes itself would be the only responses in this API that a
client cannot parse like the rest — the risk plan 04 called out. `FilterChainProblemBodyTest`
compares those two bodies strictly.

### Login hardening and password reset

An unknown address, a wrong password and a deactivated account return a **byte-identical**
401, and login performs exactly one BCrypt verification on every path — including when there
is no user at all, against a hash of a random value computed at startup — so the timing does
not answer what the body refuses to. `AuthFlowIT` asserts the three bodies are equal as
strings.

`forgot-password` always answers `202`, whether or not the address exists (D6). A reset token
is single use, expires in an hour on the injected clock, and on success **revokes every refresh
token the user holds** — a reset exists to end the sessions a compromise created, and one that
leaves them alive has accomplished nothing.

**Password length is 8 characters minimum, 72 *bytes* maximum**, declared once as `@Password`
and applied to register, accept-invitation and reset-password alike. The unit is the whole
point: BCrypt only looks at 72 bytes, so 72 *characters* is a different and wrong rule — 72
Cyrillic characters are 144 bytes. Spring Security's encoder does not silently truncate them,
it throws, so a character-counted limit turned an over-long passphrase into an unhandled 500 on
two unauthenticated endpoints and on the one link an invited colleague ever gets. The minimum
stays in characters, where the entropy is. `PasswordsTest` pins both BCrypt behaviours the rule
rests on, because an argument about a library is worth what the assertion under it is worth.

Rate limiting sits in front of all of this (see below), and deliberately ahead of Spring
Security: BCrypt at strength 12 makes an unlimited login endpoint a CPU amplifier.

**No password is hashed inside a transaction.** Hibernate holds the connection it acquired until
the transaction ends, so hashing inside one parks a pooled connection for the hundreds of
milliseconds BCrypt is meant to cost — with `maximum-pool-size: 10` that caps sign-ins near
forty a second and lets a login burst starve unrelated requests. `register`, `reset-password`
and `accept-invitation` hash first and then open a short `TransactionTemplate` around their
writes; `login` needs no transaction at all. A template rather than a `@Transactional` private
method because that is a self-invocation, which does not pass through the proxy: the annotation
would be ignored and `register` would quietly stop being atomic while every test still passed.

For the same reason `refresh` is not transactional. The reuse branch of rotation revokes the
chain in a `REQUIRES_NEW` transaction so the revocation survives the exception that reports it,
and suspending a transaction does not release its connection — nested, one replayed token cost
two connections at once, so ten simultaneous replays could stall a pool of ten. The two
transactions now run in sequence: measured peak on the real path is one connection, and
`REQUIRES_NEW` stays so the guarantee holds even if some future caller does wrap it.

**`register` is deliberately not indistinguishable, and that is worth saying out loud.**
`409 EMAIL_TAKEN` versus `201` tells an unauthenticated caller whether an address has an
account here, across every tenant, at ten probes a minute per IP. It stays because the only
honest way to mask it is `202 "check your inbox"` with the address verified by mail before the
account works, and the mail transport is plan 12 — until then, faking the success would mean
returning a session for a tenant that was never created. Reordering the two checks buys
nothing (a prober supplies a fresh slug), and one generic `409` breaks the requirement that
the sign-up form can offer an alternative slug inline. What the trade must not reach is
`login`, where the same fact would tell an attacker when they had guessed a password rather
than merely that an account exists.

## Tenant isolation

The tenant id is the `bid` claim of the access token. Not a path variable, not a query
parameter, not a body field — a caller who could name their own tenant would not need to
attack anything.

Two mechanisms, in this order:

1. **Repositories take `businessId` as a parameter.** `findByIdAndBusinessId`,
   `findByBusinessId`, `countByBusinessIdAndRoleAndActiveTrue`. A foreign row is never
   loaded, rather than loaded and then rejected — and the scoping is in the method signature
   instead of in a `WHERE` clause somebody has to remember.
2. **`TenantContext` guards the paths that legitimately load by id first.** It reads the
   principal the JWT filter put in the `SecurityContext` and offers
   `requireOwned` / `requireOwnedForWrite` over the `TenantOwned` interface, so there is no
   per-entity overload to forget when a twelfth entity arrives.

The two guards throw different exceptions on purpose:

| Path | Verdict | Why |
|---|---|---|
| read | `404 NOT_FOUND` | A foreign id must be indistinguishable from a nonexistent one. `403` confirms the row is real, which turns any admin endpoint into an existence oracle: iterate ids, collect the 403s, and another tenant's data is mapped without a single field being read |
| write | `403 ACCESS_DENIED` | A write attempt is not a survey, and the honest answer is more useful — the caller is authenticated and is being refused |

`CrossTenantTestBase` is the harness that makes "every admin endpoint has a cross-tenant
test" affordable: a subclass lists its endpoints and inherits both assertions.
`StaffCrossTenantIT` is the first subclass; plans 07–13 each add one.

Each case names **two** paths — the one reaching into the other tenant and the equivalent one
inside its own. The second is the control, and it is not decoration: a cross-tenant read test
asserts a `404`, and a mistyped path returns `404` for everyone, so without the paired
positive call a subclass with a typo in its URL passes forever while testing nothing. That is
the failure mode that makes a security test worse than no test, because it is believed.

## Staff and invitations

An invitation is a `User` row created inactive with a null password hash, **plus** a
first-class `staff_invitation` holding the hashed token — not a bare emailed link. That is
what makes it listable, resendable, expirable and consumable exactly once, and it closes open
question #1 in `docs/README.md`.

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/staff` | OWNER, STAFF |
| `GET` | `/api/staff/{id}` | OWNER, STAFF |
| `POST` | `/api/staff/invite` | OWNER |
| `POST` | `/api/staff/{id}/invite/resend` | OWNER |
| `PATCH` | `/api/staff/{id}` | OWNER, or STAFF on themselves |
| `GET` | `/api/public/invitations/{token}` | public |
| `POST` | `/api/public/invitations/{token}/accept` | public |
| `GET` | `/api/public/businesses/{slug}/staff?serviceId=` | public (D9) |

`GET /api/staff/{id}` is the one endpoint here the plan did not list. It is what the staff
detail screen reads, and it is also the read path a cross-tenant test needs in order to assert
a `404` at all.

Rules worth knowing:

- **Accepting is idempotent-by-refusal.** A second accept is `410 INVITATION_CONSUMED`, never
  a `500` and never a silent success — a silent success would be a password reset for an
  account already in use, reachable by anyone who kept the original mail. An unknown token is
  `404`, a spent or expired one `410`: for the person holding the link, one is a typo and the
  other means "you have already done this".
- **Resending supersedes.** Without it, every "I never got the mail, send it again" leaves
  another live key to the account for a week.
- **Addresses are globally unique (D13).** Inviting someone who already has an account
  anywhere is `409 EMAIL_TAKEN`.
- **Roles are checked where the rule lives.** `@PreAuthorize("hasRole('OWNER')")` for
  owner-only operations; "an owner, or a staff member acting on themselves" is in the service,
  because no URL pattern or annotation can express it. A staff member who sends `role` or
  `active` is refused rather than having it quietly dropped.
- **Deactivation, decided and written down.** It blocks login immediately, revokes the
  member's refresh tokens, and removes them from the public staff list — and **leaves their
  future bookings intact**, visible in the admin calendar. Silently cancelling or reassigning
  a real customer's appointment is worse than the awkward state, so the `PATCH` response
  carries a warning naming how many bookings are affected and when the first one is, and the
  owner decides. Their access token still works for up to fifteen minutes, the same documented
  window as everywhere else.
- **The last active owner cannot be deactivated *or* demoted** → `409 LAST_OWNER`. A business
  with no active owner has nobody who can invite one.
- **A pending invitee cannot be activated by flipping the flag** → `409`. The invitation is the
  only route from invited to active, because it is the only route that sets a password;
  otherwise the result is a user who is active, cannot log in, and is nonetheless listed on the
  public booking page as somebody a customer can book with.
- **A deactivated colleague cannot be re-invited, and cannot accept** → `409` on resend and
  `410` on accept. The mirror of the rule above, and the reason both exist: "has a password" is
  the test, not "is active". A deactivated ex-employee is inactive with their hash still in
  place, so a guard that only checks `active` mails them a live seven-day link and lets them
  choose a new password — self-service reactivation of an account somebody deliberately
  switched off. Resending is for people who have never accepted; reactivating is
  `PATCH /api/staff/{id}` with `active: true`, and the owner has to do it.
- **The list says which of the two an inactive row is.** `accepted` is true for a deactivated
  colleague and false for an invitee, because `invitationPending` cannot carry that on its own:
  an invitation that ran out weeks ago leaves the two looking identical, with opposite correct
  actions.
- **Mail is sent after the commit, never inside it.** A service publishes a
  `NotificationRequest` and `NotificationDispatcher` delivers it on `AFTER_COMMIT`. Sending from
  inside the caller's transaction means a commit that fails afterwards — the
  `app_user_email_key` race, a dropped connection, any later exception — leaves a live-looking
  seven-day link in an inbox for a row that never existed, and nothing for the owner to resend
  from. An event rather than a `TransactionSynchronization` per call site, because plan 12 adds
  several more senders and "remember to defer this one too" is a hope, not a rule.
- **The emailed links put the token in the path**, not in a query string:
  `{FRONTEND_BASE_URL}/accept-invitation/{token}` and `/reset-password/{token}`. A query string
  travels in the `Referer` header of every asset the page loads, is kept verbatim in browser
  history and synced-profile backups, and is reported in full by any analytics beacon — and what
  is in this URL is a live credential, seven days for an invitation and one hour for a reset.
  `PublicInvitationController` takes its token in the path for the same reason, and an argument
  made only on the reading side is undone by whoever writes the URL. **This assumes two SPA
  routes**, `/accept-invitation/:token` and `/reset-password/:token`; nothing serves them yet,
  which is why the shape is settled here rather than inherited from whatever the wave-3 stub
  happened to emit.
- **The public staff DTO is written by hand.** `PublicStaffResponse` is id and display name;
  reusing the admin record would publish every field it ever grows, and the leak would arrive
  through a change to a class nobody was thinking about at the time.
  `PublicStaffEndpointIT` asserts the absence of an email address **on the raw JSON**, because
  a test that maps the response back into a DTO cannot fail when a sixth field appears.

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
- The auth stack above: registration in one transaction, refresh rotation with reuse
  detection, password reset, and the problem-detail 401/403 from inside the filter chain
- Tenant isolation: the `bid` claim, `TenantContext`, and `CrossTenantTestBase` — the harness
  every later admin plan extends
- Staff and invitations: invite, resend, accept, deactivation semantics, and the public
  booking-page staff list (D9)

## Not built yet

The availability engine, the catalog, bookings, payments and the dashboard. Service
assignments are read everywhere they matter but nothing writes them yet, so `serviceIds` is
empty until plan 07. Email has no
transport yet: `NotificationService` is an interface with a logging implementation, so the
invitation and reset links are read from the api log until plan 12. Build order is tracked in
the local project brief (see `docs/`, not committed yet).
