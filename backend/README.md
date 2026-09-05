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
| `payment` | Stripe Checkout session + webhook; today, the feature flag that keeps it off |
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

## Catalog

What a business sells, and who performs it. The Java type is `ServiceOffering`; the path and
every DTO keep the word *service* (D8).

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/services?active=&page=&size=` | OWNER, STAFF |
| `GET` | `/api/services/{id}` | OWNER, STAFF |
| `POST` | `/api/services` | OWNER |
| `PATCH` | `/api/services/{id}` | OWNER |
| `DELETE` | `/api/services/{id}` | OWNER |
| `GET` | `/api/public/businesses/{slug}` | public |
| `GET` | `/api/public/businesses/{slug}/services` | public |

Rules worth knowing:

- **`staffIds` on a `PATCH` has three spellings and two meanings.** Absent and `null` both mean
  "leave the assignment set alone" — Jackson cannot tell them apart in a record component, and
  inventing a third meaning would cost a `JsonNullable` wrapper on every optional field in the
  API to express an intention no client has. `[]` means "unassign everyone", which is legal and
  comes back as `bookable: false`. `CatalogIT` tests all three, because a rule about JSON
  absence that lives only in a javadoc changes the first time somebody edits the mapper.
- **`bookable` is derived and covers three cases.** False when the service is inactive, when
  nobody is assigned, and when everybody assigned has been deactivated. All three produce
  exactly no availability, and the second and third look completely different on an admin
  screen — a flag that only covered one of them would drive a warning that is wrong half the
  time. It is what stops "why does nothing show up on my booking page?" being a support thread.
- **Duration is 5–480 minutes and a multiple of 5, and is *not* validated against
  `slotGranularityMinutes`.** The tempting wrong rule: granularity governs where a slot may
  *start*, so a 45-minute service on a 15-minute grid is ordinary. Tying them together would let
  a policy change invalidate a catalog that was never wrong. There is a test that asserts the
  45-on-30 case is accepted, so the decision cannot be "fixed" by accident.
- **`DELETE` is a soft delete** — `active = false`, the same thing `PATCH {"active": false}`
  does. The service leaves the public list immediately, its bookings stay readable and priced as
  they were sold, and `active: true` brings it back. This is not caution: `booking`'s foreign key
  is `NO ACTION` (D15), so a hard delete of a service with history is refused by the database,
  and the alternative to a soft delete is a 409 the owner can do nothing about.
- **Editing a price or a buffer never reaches an existing booking** (D14). Bookings snapshot
  both at creation, so a price rise applies to the next customer and the blocked window an
  appointment already holds does not shrink underneath the exclusion constraint keeping the slot.
  One assertion in `CatalogIT` for a decision that would otherwise be an argument.
- **A cross-tenant `staffIds` is `422 STAFF_NOT_IN_BUSINESS`, listing the ids that failed**, so a
  form with one stale row can say which one. The check is not what makes it safe —
  `staff_service`'s two composite foreign keys make a cross-tenant row unrepresentable, for psql
  as much as for the service class — it is what turns that guarantee into an answer a form can
  display. Deactivated colleagues stay assignable: they produce no availability, and refusing
  would mean an owner editing a price loses the assignments of anybody currently switched off.
- **The public business page is one round trip**: name, timezone, currency, deposit rule, the
  active catalog, and the opening hours. Its `depositRequired` is the *effective* answer, so a
  business with the flag on and a percentage of zero reports `false` — sending a customer to a
  checkout for nothing is worse than an inconsistent-looking form.
- **Opening hours are derived, not stored** (D5). Hours belong to people, so the page reports the
  union across *active* staff per weekday, earliest start to latest end, with days nobody works
  absent. It is a hull and not a schedule: a two-person salon working 09:00–12:00 and 14:00–18:00
  reports 09:00–18:00, and whether 12:30 is bookable is the availability engine's answer. A night
  shift carries `closesNextDay: true`, because `22:00 → 02:00` without it cannot be told from a
  twenty-hour day somebody typed backwards.

## Availability configuration

Everything the availability engine will consume, editable through the API. `exceptions` on the
wire, `AvailabilityOverride` in the code (D8).

| Method | Path | Auth |
|---|---|---|
| `GET` `/` `PUT` | `/api/staff/{id}/working-hours` | OWNER, or STAFF on themselves |
| `POST` | `/api/staff/{id}/exceptions` | OWNER, or STAFF on themselves |
| `DELETE` | `/api/staff/{id}/exceptions/{exceptionId}` | OWNER, or STAFF on themselves |
| `GET` | `/api/exceptions?from=&to=` | OWNER, STAFF |
| `POST` | `/api/exceptions` | OWNER |
| `DELETE` | `/api/exceptions/{id}` | OWNER |
| `GET` `/` `PUT` | `/api/policy` | GET: OWNER, STAFF · PUT: OWNER |
| `GET` `/` `PUT` | `/api/business` | GET: OWNER, STAFF · PUT: OWNER |

**The authorisation rule, written down once:** an owner edits anyone in the tenant, a staff
member edits only their own hours and their own overrides. The use-case diagram implies it
("manage **own** working hours") and the brief never said it. It cannot be an annotation,
because it depends on the id in the path, so it is one `TenantContext.requireOwnerOrSelf` call
in each service — the same one the staff patch makes — and both branches are tested.

Rules worth knowing:

- **Working hours are a full weekly replace, not a per-row patch.** The editor is a seven-row
  grid and the server's copy has to end up being exactly what is on the screen; a per-row
  `PATCH` makes the client work out which rows were added, edited and removed since it loaded
  the page and issue them in an order that never leaves a half-saved week behind. One body, one
  transaction, one outcome. A flat list of `{dayOfWeek, startTime, endTime}` with **no row ids**,
  because publishing an id invites exactly the per-row patch the endpoint exists to avoid.
- **A day with no entry is a day not worked**, not "inherit" — there is nothing to inherit from,
  and `ranges: []` is a legal body meaning this person works no fixed hours.
- **Ranges are a set per weekday.** Split shifts (`09:00–12:00`, `13:00–17:00`) are the normal
  case, `end < start` is a night shift and is accepted, and `end == start` is refused with the
  row's own path in `errors[]` (`ranges[1].endTime`).
- **A second identical `PUT` is a no-op down to the row ids.** The service compares the requested
  week with the stored one and returns early. Without it, every save of an unchanged grid deletes
  seven rows and inserts seven more against the one table the engine reads on every request — and
  "did anything change?" stops being answerable from the data.
- **Overlaps are checked across the week, not within a day** → `422 HOURS_OVERLAP` naming the
  weekday. The plan asks only for the within-a-day case, which is the one a client hits; the same
  mistake is expressible across midnight (a Monday `22:00–02:00` shift beside a Tuesday
  `01:00–03:00` one overlaps on Tuesday morning and shares no weekday), and a Sunday night shift
  wraps onto Monday. Laying the week out as minutes from Monday midnight makes all of it one
  check with one error code. Intervals are half-open, so ranges that merely touch at noon are
  adjacent rather than overlapping — the same convention the booking exclusion constraint uses.
- **Overlapping *overrides* on one date are allowed**, including a `BLOCKED` and an `EXTRA` over
  the same hour. The engine owns precedence (plan 09, where `BLOCKED` always wins), and refusing
  every combination this layer cannot interpret would refuse the ordinary case of a closure with
  one person's extra hours layered on it.
- **`BLOCKED` with no times is a whole day; `EXTRA` with no times is `422`.** "Available, from no
  time until no time" is a sentence with no meaning, and the schema refuses it as well. One time
  without the other is a bug rather than a meaning, and is refused too.
- **A business-wide closure is one row with `staff_id NULL`** (D5), owner-only, whole-day or a
  range. It appears **once** in `GET /api/exceptions` with `businessWide: true` and applies to
  everybody, now and to whoever joins later — fanning it out into a copy per staff member would
  produce ids that can be deleted individually, which is a closure that can be half-removed.
  `EXTRA` is refused at this level: a business can declare itself shut on its staff's behalf, but
  only the person working an evening can declare themselves available for it.
- **The merged view is one query**, because `business_id` is on every row whichever level it
  belongs to. Staff can read it: somebody has to be able to see the closure that is about to
  cancel their Tuesday.
- **`slotGranularityMinutes` is one of 5, 10, 15, 20, 30 or 60** → anything else is `422`. The
  database allows 1–480 because a check constraint is a floor, not a product decision; 7 minutes
  is legal arithmetic and a baffling slot list (`09:00, 09:07, 09:14`). Every allowed value
  divides 60, so the grid does not drift against the wall clock through the day.
- **`MISSING_PARAMETER` became reachable here.** `GET /api/exceptions?from=&to=` is the first
  endpoint with a required query parameter, and until now every 400 fell through to the generic
  `MALFORMED_REQUEST` — so "you forgot `from`" and "your body is not JSON" were the same answer.
  The parameter is named in `detail`, not in `errors[]`, which stays a 422 member.
- **Changing the timezone requires `confirmShift: true`** → otherwise `409
  TIMEZONE_SHIFT_UNCONFIRMED` carrying `affectedBookings`. Working hours are wall-clock times
  read in *this* zone (D11), so "09:00 on Tuesdays" is not a fact about a moment until this field
  says which moment — and moving it moves every future slot the engine will compute while every
  customer holding a confirmation keeps their instant. The 409 is returned **even when the count
  is zero**: the bookings are the visible consequence, not the reason, and an endpoint that only
  asks when it has something to warn about is one whose behaviour nobody can predict. Nothing is
  normalised in either direction — not the hours, not the bookings — because there is no way to
  know which intention the operator had.
- **The slug is not editable at all.** It is the public URL segment; a booking page whose address
  changes breaks every link the business has ever sent a customer. `Business` has no setter for
  it and `BusinessRequest` has no field.
- **Neither settings endpoint needs a tenant guard**, and that is worth saying rather than
  noticing: there is no id in either path, so the row is always the one in the token and "another
  tenant's settings" is not a request they can express. What they need is a role check, which an
  annotation can do.
- **Staff in other timezones is out of scope for v1** — one business, one timezone. A per-staff
  zone would mean the engine resolving wall-clock hours against a different zone per candidate,
  which is a plan-09 change and not a settings field.

## The availability engine

The thing the rest of the project exists to make possible. Given a business, a service, a
staff member (or "any") and a date range, it returns the exact set of bookable start times.

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/public/businesses/{slug}/availability?serviceId=&from=&to=&tz=&staffId=` | none |

```
availability/domain/TimeWindow.java          the vocabulary: [start, end) over Instant
availability/domain/Slot.java                a start, an end, and who can serve it
availability/domain/AvailabilityQuery.java   everything the engine needs, already loaded
availability/domain/AvailabilityEngine.java  pure; no Spring, no @Service, no repository
availability/AvailabilityService.java        loads the data, calls the engine, maps DTOs
availability/AvailabilityController.java     the one public endpoint above
```

**The engine is a pure function, and that is the load-bearing decision.** It takes an
`AvailabilityQuery` and returns slots; it never asks a repository a question and never reads a
clock — the policy window arrives as two instants the service computed from the injected `Clock`.
The whole test matrix therefore runs against no Spring context and no container, in under a
second, which is why cases nobody would set up against a database — a spring-forward Sunday, a
booking two months out, a shift that starts in an hour that does not exist — are cheap enough to
have. Wiring the controller first and backing into the algorithm is the version of this that
takes twenty-five hours instead of ten.

### The pipeline

Per candidate staff member, over every business-zone date the range touches:

1. **Materialise the weekly template** into instants with
   `ZonedDateTime.of(date, localTime, businessZone)`. A row whose end is before its start is a
   night shift and ends on `date + 1`.
2. **Add the `EXTRA` windows** and coalesce, so extra hours that touch the template extend it
   rather than starting a second window beside it.
3. **Subtract the `BLOCKED` windows**, business-wide (D5) and staff-level alike.
4. **Subtract the bookings**, as `[blocked_from, blocked_to)` — the buffer-expanded pair already
   stored on the row (D4), which is the same interval the exclusion constraint ranges over, so the
   engine cannot offer a start the insert would then refuse.
5. **Walk** what is left in `slotGranularityMinutes` steps, keeping a start only when
   `[start - bufferBefore, start + duration + bufferAfter)` fits wholly inside the window.
6. **Clamp** to `now + minLeadTimeHours` … `now + maxAdvanceDays`, and to the requested range.

### Rules worth knowing

- **`BLOCKED` always beats `EXTRA`.** At every level, whatever the insertion order. A staff
  member's extra evening cannot reopen a business-wide closure, and a day off written after the
  extra hours removes them just as it would have done written before. The rule is arbitrary — the
  opposite one is equally implementable — which is exactly why it is stated here rather than left
  to be inferred from behaviour. It falls out of the pipeline order above rather than from a
  special case.
- **Half-open `[start, end)` everywhere**, matching the `tstzrange` default the exclusion
  constraint uses and the working-hours overlap check. A 09:00–10:00 booking and a 10:00–11:00
  booking do not overlap. Windows that merely touch coalesce, which is what makes a gapless split
  shift one unbroken eight hours rather than two.
- **Buffers fit inside working hours; they do not spill past the edges.** With ten minutes of
  setup, the first appointment of a 09:00 day is not at 09:00, because setting up at 08:50 means
  opening at 08:50. Same at the other end: a cleanup buffer that would run past closing removes
  the last slot.
- **The grid is anchored at each window's own start, not at midnight.** A window that begins at
  13:15 because a booking ended there offers 13:45 next on a half-hour grid, not 13:30 — the
  earliest moment the work can actually begin. The cost is that the afternoon's starts need not
  line up with the morning's once something has been taken out of the day.
- **`?tz=` decides where the `from`/`to` days begin and end, and nothing else.** Working hours are
  always read in the **business** timezone (D11) — a salon opens at 09:00 local whatever the phone
  booking it says. A customer in Tokyo asking for "Wednesday" gets the window their Wednesday
  covers, which is the tail of the salon's Tuesday plus most of its Wednesday. Every returned
  instant is UTC.
- **A slot carries every staff member who could serve it.** An any-staff query is the union across
  everyone who performs the service, deduped by start instant. Picking one here would mean always
  sending work to the lowest id and would throw away the only place the alternatives are known;
  plan 10 chooses between them when the booking is made (fewest bookings that day, then lowest id).
- **DST is handled by `ZonedDateTime.of`, and both of its behaviours are the ones wanted.** In a
  spring-forward gap it moves the local time forward by the length of the gap, so a 02:00–02:30
  shift becomes 03:00–03:30 and keeps its length; in a fall-back overlap it takes the earlier
  offset, so the 25-hour day is fully worked and its two 02:00s are two distinct instants. The one
  shape that leaves nothing behind is a range that *starts* inside the gap and ends after it —
  02:30–03:15 runs backwards once resolved — and that window is dropped rather than thrown on.
- **A slot is an offer, not a hold.** Nothing is written here and two customers may be looking at
  the same 10:00. Which of them gets it is decided by the exclusion constraint when one of them
  books, because a check-then-insert across two requests has a race in it that no amount of
  reading can close.
- **Refusals name what is wrong**: an unknown slug or service is `404`, a deactivated service is
  `422 SERVICE_INACTIVE` rather than a silent empty list, a staff member who does not perform the
  service is `422 STAFF_NOT_ASSIGNED`, and a backwards or oversized range is a `422` naming `to`.
  The range is capped at **62 days** — an anonymous endpoint with an unbounded range is a request
  for a decade of slots that costs the server a decade of work.
- **A deactivated staff member disappears from the answer without being unassigned.** "Who
  performs this service" and "who can be offered" are genuinely different sets, and the assignment
  is deliberately left alone so that reactivating somebody restores their calendar (plan 06).

### Seven statements, whatever the range

The working hours, the overrides and the bookings are fetched **once each**, for the whole range
and all candidate staff, and the fold happens in memory. Four more resolve what was asked about:
the business, the service, the policy, and who can perform the service. The number that matters is
not seven but that it is *the same seven* for one day as for sixty, and for three staff members as
for one — `AvailabilityQueryCountIT` asserts it from both ends with a Hibernate statement counter,
because a per-day loop produces a response nobody can tell apart from the right one and a month
view that takes five seconds. A service nobody is assigned to skips the three loads entirely.

## Bookings

The point of everything above. A guest picks a start from the availability response, posts it, and
the **database** — not the application — guarantees they are the only one who got it.

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/public/businesses/{slug}/bookings` | none, rate limited |
| `GET` | `/api/public/bookings/{cancellationToken}` | the token |
| `DELETE` | `/api/public/bookings/{cancellationToken}` | the token |
| `GET` | `/api/bookings?from=&to=&status=&staffId=&page=&size=` | OWNER, STAFF |
| `GET` | `/api/bookings/{id}` | OWNER, STAFF |
| `PATCH` | `/api/bookings/{id}/status` | OWNER, STAFF |

```
booking/Booking.java                  the entity, and the transition matrix that lives on it
booking/PublicBookingService.java     create, look up by token, cancel
booking/BookingAdminService.java      the calendar from inside the business
booking/BookingConflictException.java the 23P01 translation, and only that
booking/ExpiredBookingSweeper.java    releases abandoned deposit holds (D3)
booking/BookingEvent.java             what plan 11 and plan 12 subscribe to, after commit
```

### The double-booking guarantee

```sql
EXCLUDE USING gist (staff_id WITH =, tstzrange(blocked_from, blocked_to) WITH &&)
  WHERE (status IN ('PENDING', 'CONFIRMED'))
```

Everything the service does before the insert is an optimisation and a source of good error
messages. This constraint is the guarantee, and it is a guarantee precisely because it is *not* a
read followed by a write: two requests arriving in the same millisecond produce one row and one
`23P01`, whatever either request believed a moment earlier. `BookingConcurrencyIT` is the test —
two threads, one `CountDownLatch`, real Postgres, nothing mocked — and it asserts the pair: exactly
one `201`, exactly one `409`, exactly one row.

It ranges over `blocked_from`/`blocked_to` rather than the appointment (D4), so a booking whose
*buffers* overlap an existing one is refused too, even though the two appointments are half an hour
apart. That is the same rule the engine applies, which is what stops the API offering a slot the
insert would then reject.

**Matched by SQLState, never by name.** Hibernate wraps the violation two or three levels deep, so
`BookingConflictException.isSlotOverlap` walks the cause chain to `SQLException.getSQLState()` and
compares `23P01`. A `getMessage().contains("booking_no_overlap")` works today and breaks the day
somebody renames the constraint — on the one path where breaking means a 500 instead of a 409.

**Deadlocks are the same event with a different exception.** When the two blocked ranges are
identical the second inserter waits and gets a clean `23P01`; when they merely overlap, each
transaction can end up waiting on the other's index entry and Postgres kills one with `40P01`. The
survivor still commits, so the outcome is still exactly one booking — only the loser's exception
differs, and it is reported as the same `409`.

### 409 or 422: taken versus never on offer

A slot the engine withheld because somebody else has it is a **409**: the client should refetch and
re-render, and the constraint would have said the same a moment later. A start the calendar would
never have offered is a **422** with a specific code, because refetching will not change the answer.
Telling those apart costs no extra query — the engine is a pure function, so
`AvailabilityService.verify` folds it twice, once against the real calendar and once against the
same calendar with every booking removed. The difference between the two answers is exactly
"somebody else got there first".

| Code | Meaning |
|---|---|
| `SERVICE_INACTIVE` | the service is not bookable at all |
| `STAFF_NOT_ASSIGNED` | that person does not perform it — or nobody does |
| `POLICY_LEAD_TIME` / `POLICY_MAX_ADVANCE` | outside the bookable window; the body carries the boundary |
| `SLOT_NOT_ON_GRID` | not one of the start times this business offers |
| `SLOT_OUTSIDE_HOURS` | nobody is working then |
| `BOOKING_SLOT_TAKEN` | 409; the body echoes the slot so the client can retire that offer |

The grid check is used to *name* a refusal and never to gate one. Plan 09 anchors the grid at each
open window's own start rather than at midnight, so after a booking ending at 13:15 the next offer
on a half-hour grid is 13:45 — a start a midnight-anchored modulo would have rejected, and one this
API really does advertise.

### The lifecycle

| From \ To | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW |
|---|---|---|---|---|
| `PENDING` | webhook or sweeper only | yes | no | no |
| `CONFIRMED` | — | yes | after `endsAt` | after `startsAt` |
| `CANCELLED` | no | — | no | no |
| `COMPLETED` | no | no | — | no |
| `NO_SHOW` | no | yes | yes | — |

Enforced on the entity, not in a controller. Three callers move a booking through its life — the
admin `PATCH`, the Stripe webhook and the expiry sweeper — so a guard living in one of them protects
only that one. Illegal moves are `409 ILLEGAL_TRANSITION` naming both states in the body.

`PATCH` refuses `CONFIRMED` from every source state, even the one the entity allows (D2): a deposit
arriving is what confirms a booking, and staff never press a button to do it. The two time guards
are not overridable either — a completed appointment in the future is a data-quality bug that
resurfaces as a wrong number on the dashboard.

### Cancellation

A customer cancels through the token, subject to `cancellationCutoffHours`; past it,
`409 CANCELLATION_CUTOFF` carries the deadline. Staff cancel through `PATCH` and ignore the cutoff —
it is a promise made to customers about how late *they* may change their mind, and a salon whose
stylist calls in sick has to be able to cancel. Either way the slot is free the instant the
transaction commits, because the constraint's `WHERE` clause stops matching the row; there is no
cleanup job in between.

**`depositRefundable` is `false`, and it is a field rather than a footnote** (D7). Refunds are out of
scope, so the money is kept whichever way the customer goes. That has to be disclosed rather than
discovered, which means the manage page needs it as data it can render next to the button, before
the click — so it is on the detail payload, on the successful cancel, and on the refusal.

### Deposit holds and the sweeper (D3)

With `app.payments.enabled=false` — the default, and this version's whole configuration — every
booking is created `CONFIRMED` and nothing reaches Stripe. With it on, a deposit-requiring business
creates a `PENDING` booking with `expiresAt = now + 30 min`. `PENDING` is inside the exclusion
constraint, so an abandoned checkout would hold its slot forever; `ExpiredBookingSweeper` runs every
minute and releases the stale ones.

The sweeper is the one genuine concurrency hot spot outside the constraint, because the payment
webhook writes the same row. Each booking gets its own transaction, the expiry is re-checked inside
it, and `@Version` closes the remaining window — a lost race throws `OptimisticLockingFailureException`
and is treated as a no-op, which is correct, because the only other writer is a payment that
actually arrived.

### Guest contact details

There is no customer account (D1), so the three contact fields *are* the customer and the
cancellation token is their only credential. They appear in exactly two responses — the token lookup
and the admin detail view — and nowhere else: not on the creation response, not in the admin list
(which carries the name alone, because a leak on a page of forty rows is forty leaks), and not on
anything the availability endpoint returns.

### Terms are snapshotted (D14)

`priceCents` and both buffers are copied onto the row at creation. Editing a service changes what
the *next* customer pays and how much calendar the next appointment costs, and leaves every
appointment already agreed exactly as it was — including the blocked range the constraint is holding
the slot with.

### After commit, or not at all

`BookingEvent.Created` and `BookingEvent.Cancelled` are published inside the booking transaction and
delivered by `@TransactionalEventListener(AFTER_COMMIT)`. Nothing subscribes to them yet beyond a log
line; plan 11 hangs the Checkout session there and plan 12 the two confirmation emails (D10). The
boundary is in now because retrofitting it later is how a rolled-back booking ends up emailing a
customer about an appointment nobody has — and `BookingEventIT` asserts that a transaction which
rolls back notifies nobody, so the wiring is real rather than decorative.

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

**Concurrency is tested with latches, never with sleeps.** `BookingConcurrencyIT` releases two
threads at the same instant through two `CountDownLatch`es and asserts the outcome *pair* — one
`201`, one `409`, one row. A `Thread.sleep` there would make the overlap probabilistic: too short
and the threads miss each other, too long and the build is slower for nothing, and either way the
test is a coin flip dressed as an assertion.

**Two jobs are switched off for the whole suite** and called directly instead: the token sweep and
the booking expiry sweep. Both delete or cancel rows, this suite moves the clock forward by days at
a time, and which test lost its fixture would otherwise depend on the time of day the build ran.

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
- The catalog above: services CRUD with the assignment set, the soft delete, and the two public
  endpoints the booking page opens with — including the opening hours derived from staff working
  hours (D5)
- The availability configuration above: the weekly template as a full replace, staff and
  business-wide overrides, the booking policy and the business settings — everything the engine
  is about to consume, editable, validated and tenant-safe
- The availability engine above: `TimeWindow` and the pure-domain engine, the loader that feeds it
  in three queries, and the one public endpoint the booking calendar polls — with the plan's whole
  test matrix as named tests, DST included, running with no container in under a second
- Bookings above: the creation path with its six named refusals, the lifecycle behind
  `PATCH /status`, the token-only manage page, the deposit sweeper, and the after-commit event
  boundary that plans 11 and 12 hang off — and, underneath all of it, the concurrency test that
  makes the README's central claim something you can run rather than something you have to believe

## Not built yet

**A business cannot create a booking on a customer's behalf.** There is no admin
`POST /api/bookings`; the only creation path is the public
`POST /api/public/businesses/{slug}/bookings`, so a phone booking has to be entered through the
public flow. That is the one substantive gap left in the API.

Everything this section used to list is built. Payments are real — `StripeCheckoutSessions`
opens the session, `StripeWebhookController` and `StripeWebhookService` confirm the booking
against a `stripe_event` primary key that makes a replay a duplicate-key error, and
`DepositService` snapshots what was owed. Mail has a transport: `MailNotificationService`
sends through the configured relay, `IcsCalendar` attaches the invitation, and
`BookingReminderJob` runs the reminder. `DashboardController` serves the figures. What remains
off in a fresh environment is `app.payments.enabled`, which is configuration rather than
absence — the deposit path is exercised end to end whenever it is on.
