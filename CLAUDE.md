# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SlotFlow — a multi-tenant appointment booking platform. Two independent deployables that share
nothing but the HTTP contract: `backend/` (Spring Boot 3 / Java 21 → Render) and `frontend/`
(React 19 + TypeScript + Vite → Vercel).

The long-form reasoning behind almost every decision below lives in `README.md`,
`backend/README.md` and `frontend/README.md`. Those three files are the design record — read the
relevant section before changing behaviour they describe, and update them when you do. Payments,
notifications, the dashboard and every admin screen are built; the "Not built yet" sections now
name the one real gap, which is that a business cannot create a booking on a customer's behalf.

## Commands

The whole stack:

```bash
cp .env.example .env       # placeholders are fine locally; JWT_SECRET must be set
docker compose up          # postgres + mailhog + api, seeded with the demo profile
```

Backend (`cd backend`; on PowerShell use `.\mvnw.cmd`):

```bash
./mvnw verify                             # everything — needs Docker running (~4 min)
./mvnw test                               # unit + web-slice only, no Docker
./mvnw verify -Dit.test=BookingConcurrencyIT   # one integration test
./mvnw test -Dtest=AvailabilityEngineTest      # one unit test
./mvnw spotless:apply                     # fix formatting; the gate runs at `validate`
```

`*Test` is surefire (unit/web-slice), `*IT` is failsafe (Testcontainers). The two read *different*
properties — `-Dtest=` filters surefire only, `-Dit.test=` failsafe only — and when running a
single IT, read the failsafe summary rather than the exit code.

Frontend (`cd frontend`):

```bash
npm run dev              # http://localhost:5173
npm run typecheck        # tsc -b across app, node and test projects
npm run lint             # eslint, zero warnings tolerated
npm run test             # vitest run
npm run test -- src/lib/time.test.ts   # one file; add -t '<name>' for one case
npm run format:check     # what CI checks
npm run contract:check   # diff Zod schemas against a running API's /v3/api-docs (needs the stack up)
npm run e2e              # Playwright; needs `docker compose up` + `npm run e2e:install` once
```

CI: `.github/workflows/ci.yml` runs `mvn -B verify` on **every** push with no `paths:` filter —
that is deliberate and load-bearing (main requires it as a status check and releases are
fast-forwards; a filtered workflow produces no check run on the released SHA). `web.yml` is
filtered because it is *not* required; the header comment says what must change before it can be
promoted. `e2e.yml` runs only on `dev` and `main`.

## Ports

`.env.example` defaults `API_PORT=8080`, but `frontend/.env.example` points at **8081** and the
local `.env` maps the API there — 8080 is taken on this machine. If a change touches the API base
URL, keep those two files agreeing.

## Architecture

**The availability engine is a pure function.** `availability/domain/AvailabilityEngine` takes an
`AvailabilityQuery` (working hours, overrides, existing bookings, policy, already loaded) and
returns slots. No Spring context, no repository, no clock read — the policy window arrives as two
instants the service computed from the injected `Clock`. That is why the DST, midnight-crossing,
split-shift and buffer cases are sub-second unit tests. Keep it that way: anything the engine needs
is loaded by `AvailabilityService` and passed in.

Pipeline order matters and `BLOCKED` always beats `EXTRA`: materialise the weekly template in the
*business* zone → add `EXTRA` and coalesce → subtract `BLOCKED` → subtract bookings as
`[blocked_from, blocked_to)` → walk in `slotGranularityMinutes` steps keeping starts where
`[start - bufferBefore, start + duration + bufferAfter)` fits → clamp to the policy window.
Intervals are half-open `[start, end)` everywhere, matching `tstzrange`.

`AvailabilityQueryCountIT` pins the query count at **seven statements regardless of range or staff
count** with a Hibernate statement counter. A per-day loop produces an indistinguishable response
and a five-second month view.

**The database is the arbiter of double booking.** `booking` stores `blocked_from`/`blocked_to`
(the appointment widened by the buffers snapshotted onto the row) and an
`EXCLUDE USING gist (staff_id WITH =, tstzrange(blocked_from, blocked_to) WITH &&) WHERE (status IN
('PENDING','CONFIRMED'))` ranges over those, not over the raw appointment. The application-level
check stays as an optimisation that produces a good error message; it is not what makes the promise
true. A violation surfaces as `409`.

**A booking is confirmed by the Stripe webhook, never by the browser redirect.**
`?checkout=success` chooses the tone of one sentence; the page reads the booking either way.
Stripe retries for three days, so the webhook is guarded twice over: `stripe_event`'s primary key is
Stripe's own `evt_...` id (a replay is a duplicate-key error from Postgres, not a check someone
remembered to write), and the transition itself only ever moves `PENDING -> CONFIRMED` or
`PENDING -> CANCELLED`. Either guard alone would do; both are there because the cost is a customer's
money. The table has no foreign key to `booking` on purpose.

**Tenant scope comes from the `bid` claim of the access token** — never a path variable, query
parameter or body field. Repositories take `businessId` as a parameter (`findByIdAndBusinessId`);
`TenantContext.requireOwned` / `requireOwnedForWrite` guards the paths that load by id first. A
cross-tenant **read** is `404` (a `403` turns the endpoint into an existence oracle), a cross-tenant
**write** is `403`. New admin endpoints extend `CrossTenantTestBase`, and every case names two
paths — the cross-tenant one *and* the equivalent inside the caller's own tenant, because a typo'd
URL returns 404 for everyone and would pass the security assertion forever.

**Time.** `timestamptz` at rest, `Instant` in Java, UTC ISO-8601 on the wire. Recurring rules are
`LocalTime`/`LocalDate`/`DayOfWeek` — "we open at nine" must survive a DST change. `?tz=` decides
only where a caller's day boundaries fall; working hours are always read in the business zone.

**`Clock.systemUTC()` appears in exactly one bean.** A direct `Instant.now()` anywhere else is a
build failure, not a style note — `TestHygieneTest` scans all of `src/test` for wall-clock reads and
for `Thread.sleep`.

**Auth.** 15-minute HS256 access token in client memory only; 7-day refresh token as a SHA-256 hash
behind an httpOnly cookie scoped `Path=/api/auth`. Refresh rotates on every use with a row lock, and
re-presenting a rotated token revokes every session that user holds and answers `401 REFRESH_REUSED`
— the revocation runs `REQUIRES_NEW` so the exception reporting it cannot roll it back. No password
is hashed inside a transaction (BCrypt 12 would park a pooled connection); use a `TransactionTemplate`
around the writes instead, never a self-invoked `@Transactional` private method.

**Rate limits are a filter, not an annotation.** `common/web/RateLimitFilter` runs bucket4j buckets
keyed by client IP and sits *ahead* of BCrypt on `POST /api/auth/login` — that ordering is the point,
so a password-spray never reaches the slow hash. Budgets are config, not code
(`app.rate-limit.*` in `application.yml`). Which address the bucket keys on depends on
`FORWARD_HEADERS_STRATEGY`: `none` locally, `framework` only behind a proxy that *overwrites*
`X-Forwarded-For` rather than appending to a caller's.

**Errors.** Every response, including 500s and ones written by filters, is `application/problem+json`
with the same members. `code` (from `common/error/ErrorCode.java`) is the only part a client branches
on. `errors[]` on 422 only, `requestId` on 5xx only. `ProblemDetailContractTest` asserts that body
strictly — adding or renaming a member fails the build, because the React forms parse those keys.

**Mail is published as a `NotificationRequest` and delivered on `AFTER_COMMIT`**, never inside the
caller's transaction.

### Frontend

`src/api/client.ts` is the one Axios instance, `withCredentials: true`, no path in `baseURL` (the
refresh cookie is `Path=/api/auth`-scoped and any prefix rewrite detaches it). On a 401 the
interceptor joins a **single in-flight refresh promise** and replays once — six parallel 401s firing
six refreshes would trip reuse detection and sign the user out. `/api/auth/login` and
`/api/auth/demo-login` are exempt: their 401 means *refused*, not *expired*.

Zod schemas in `src/api/schemas/` are the hand-written source of truth for the contract; everything
in `src/types/` is `z.infer` of them. `problemDetailSchema` is deliberately **loose** — a strict
object strips the `earliestStart`/`latestStart` a policy refusal carries.

TanStack Query's defaults are decided once in `src/api/query-client.ts` and no feature restates them:
**a 4xx is never retried** (a 403 does not improve on the second ask), a 5xx and a status-0 network
failure are; mutations never retry at all, because an auto-retried booking is how a double booking
gets made. `createQueryClient()` is a factory, not a singleton — a shared cache is what makes a test
pass alone and fail in the suite. Session restore is one refresh then one `me`, held in a
module-scope promise in `src/api/bootstrap.ts`: a `useRef` guard does not survive the `StrictMode`
double mount, and a module-level promise's lifetime is what actually means "once per page load".

Public booking flow state lives in the **URL** (`?service=&staff=&date=&slot=`), not a context. The
current step is derived from those parameters, which is what makes the `409` recovery free.

Three rules are enforced by tests, not review: every colour/radius/duration comes from a token in
`src/styles/theme.css` (`theme.test.ts`), every date read goes through `src/lib/time.ts`
(`time.test.ts` passes under any `TZ`), and prices are formatted only by `src/lib/money.ts`, which
divides by the currency's own minor units and never through a `double`.

Three route paths — `/booking/:cancellationToken`, `/reset-password/:token`,
`/accept-invitation/:token` — are named by the backend and built into already-sent mail. Not ours to
rename.

## Conventions and gotchas

- **Naming that differs between code and wire, deliberately:** the Java types are `ServiceOffering`
  and `AvailabilityOverride`; the REST paths stay `/api/services` and `/api/staff/{id}/exceptions`.
  A JPA entity named `Service` collides with `@Service`, and `AvailabilityException` reads as a
  throwable.
- **Never expose entities** — controllers return MapStruct-mapped DTOs
  (`unmappedTargetPolicy = ERROR`). A raw Spring `Page` is never returned; use `PageResponse`.
- **Entities:** UUIDs generated in Java, `Persistable` via `AbstractAuditedEntity`,
  `@Enumerated(STRING)`, foreign keys as plain `UUID` fields with no `@ManyToOne`. `ddl-auto:
  validate` means a mapping and its Flyway table cannot drift.
- **New tenant-scoped entity → implement `TenantOwned`**, which is the type the guard checks.
- **Tests:** one Postgres container for the whole integration suite, started from a static
  initialiser in `support/IntegrationTest` (not `@Container`, which restarts per class and turns 40
  seconds into 8 minutes). `support/MutableClock` is the primary `Clock`; `TestTime.NOW` is Monday
  2 March 2026 09:00 UTC. Fixtures are builders from `support/fixtures/Fixtures`. Concurrency is
  tested with `CountDownLatch`, never sleeps. The token sweep and booking expiry sweep are disabled
  for the suite and called directly.
- **Coverage is gated on `com.slotflow.availability.domain` and `com.slotflow.booking` at 90 %
  branch**, with no project-wide threshold, and a test asserts both package names still match
  something — a JaCoCo rule naming a vanished package silently stops checking anything.
- **`EnvironmentDocumentationTest` fails the build when the application reads a variable that
  `.env.example` does not document.** Adding a config property means adding it there.

## Repository workflow

- Branch is `dev`; `main` is the deploy branch and requires a green `mvn verify`. Work happens on
  `feat/**`, `fix/**` or `chore/**` branches which are pushed (so CI runs) and then fast-forwarded
  into `dev`.
- `docs/` is **not tracked in git**. It holds the project brief, the UML sources, the sixteen
  backend plans plus their eight waves (`docs/plans/backend/waves/`), the nine frontend plans, and
  the frontend review notes. Decisions are referenced across the codebase by their identifiers —
  `D1`–`D14` for backend decisions, `F5`, `F8`, `F10`, `F12`, `F16` for frontend ones — and those
  live in `docs/plans/*/00-overview.md`. A fresh clone has none of that directory, so
  those identifiers resolve only on a machine that already holds it.
- Formatting-only commits go in `.git-blame-ignore-revs`.
