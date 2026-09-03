# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The SlotFlow API: Spring Boot 3.5 on Java 21, Postgres, Flyway, deployed to Render. It serves the
React SPA in `../frontend` over nothing but HTTP, and shares no code with it.

`../CLAUDE.md` carries the cross-cutting architecture — the availability pipeline, the
double-booking guarantee, the tenant rule, the error contract — and is loaded alongside this file,
so none of that is repeated here. This file is the operational layer: how to run things, which base
class to extend, and the traps that cost an afternoon. `README.md` in this directory is the design
record and is long on purpose; read the relevant section before changing behaviour it describes, and
update it when you do. Two caveats about it: its **"Not built yet" section is stale** (payments,
notifications and the dashboard are all built), and the `D<n>` identifiers in it and in the source
resolve in `docs/plans/backend/00-overview.md`, which is **not in git** — on a fresh clone they are
dead references.

## Commands

PowerShell is the shell here, so it is `.\mvnw.cmd`; the POSIX spelling below is what the Bash tool
wants.

```bash
./mvnw verify                                  # everything: unit + web-slice + Testcontainers (~4 min, needs Docker)
./mvnw test                                    # surefire only — no Docker, seconds
./mvnw test -Dtest=AvailabilityEngineTest      # one unit test
./mvnw verify -Dit.test=BookingConcurrencyIT   # one integration test
./mvnw test '-Dtest=AvailabilityEngineTest$DaylightSaving#springForward'   # one case
./mvnw spotless:apply                          # fix formatting
./mvnw spotless:check                          # what the build gate runs, at `validate`
```

The big unit-test classes are organised into `@Nested` groups (`AvailabilityEngineTest` has
`DaylightSaving`, `AcrossMidnight`, `Buffers`, `Overrides`, `Policy`, …), so a single-case selector
needs the `Outer$Nested#method` form — and the whole argument **must be quoted**, or PowerShell reads
`$DaylightSaving` as a variable and silently sends surefire a selector matching nothing.

**The two test plugins read different properties and neither substitutes for the other.** surefire
reads `test`, failsafe reads `it.test`. `-Dtest=SomeIT verify` filters surefire and still runs every
IT. Worse, both set `failIfNoSpecifiedTests=false`, so a **typo'd selector is a green build that ran
nothing** — when selecting a single IT, read the failsafe summary rather than trusting the exit code.

Formatting is the Eclipse formatter driven by `eclipse-formatter.xml`, not google-java-format, and it
deliberately leaves author line breaks (`join_wrapped_lines=false`) and all comment text alone. If
Spotless suddenly reports every file in the project as unformatted **on your machine only**, that is
the CRLF trap: `lineEndings=GIT_ATTRIBUTES` in the POM defers to git, and the answer is never to
reformat the tree.

## Running it locally

Two ways, and they are configured differently:

- **In Compose** (`docker compose up` from the repository root) the API runs the **`demo`** profile
  and the `local` profile is *not* active — Compose passes `DB_URL` and `MAIL_HOST` as environment
  variables instead. The container listens on 8080 internally but is published on **8081**, because
  another process owns 8080 on this machine.
- **On the host** (`mvn spring-boot:run -Dspring-boot.run.profiles=local`) `application-local.yml`
  points at `localhost:5432` and MailHog on 1025. `.env` is not read by Maven, so load it into the
  shell first: `set -a; . ./.env; set +a`.

**A native Windows Postgres owns 5432 on this machine**, so a host-side run reaches *that* server
rather than the Compose one and fails with a misleading authentication error. Check which server
answered before debugging credentials.

`application-local.yml` is committed, which makes "no secrets in it" a rule rather than a habit —
`git status` will not warn you about a password pasted there. Personal overrides go in
`application-local-<yourname>.yml`, which `.gitignore` covers.

The `demo` profile is what makes the deployed demo work: `DemoDataSeeder` (`@Profile("demo")`,
re-runnable) seeds a business, and `DemoLoginController` exposes `POST /api/auth/demo-login` behind
**two** independent gates — the profile *and* a property — because either one alone is a single edit
away from a public login endpoint in production.

## Configuration

**The property prefix is `app.*`, not `slotflow.*`.** Five typed `@ConfigurationProperties` classes
own it and are the place to look before grepping YAML: `app.rate-limit`
(`common/web/RateLimitProperties`), `app.mail` (`notification/MailProperties`), `app.payments`
(`payment/PaymentProperties`), `app.stripe` (`payment/StripeProperties`), `app.security`
(`security/AuthProperties`).

`EnvironmentDocumentationTest` **fails the build when the application reads a variable that
`../.env.example` does not document**, so adding a `${SOMETHING}` means adding it there in the same
commit. Secrets are environment-only by design; nothing sensitive has a default in `application.yml`.

Jackson is configured in `config/JacksonConfig.java` and deliberately **not** in `application.yml` —
the customiser is applied after the file and would win anyway, and two spellings of one setting means
editing the visible one changes nothing.

## Layout

Packaged by feature, not by layer: each package holds its own controller, service, repository,
entity and DTOs. `availability`, `booking`, `business`, `catalog`, `staff`, `payment`,
`notification`, `dashboard` and `demo` are the features; `common` (error contract, `PageResponse`,
JPA plumbing, the two filters), `config`, `security` and `tenant` are the cross-cutting layer.

`availability/domain` is the only package with no Spring in it at all, and the coverage gate names
it — keep it that way.

## Persistence

- **Flyway is forward-only and versioned** (`db/migration/V1__baseline.sql`, `V2__stripe_events.sql`,
  `V3__booking_checkout_url.sql`). `validate-on-migrate` is on. Never edit an applied migration; add
  the next `V<n>__`.
- **`ddl-auto: validate`** means a mapping and its table cannot drift — a JPA change without the
  migration fails at startup, including in every integration test.
- Entities extend `common/jpa/AbstractEntity`, `AbstractMutableEntity` or `AbstractAuditedEntity`,
  which implement `Persistable` with a Java-generated UUID. Foreign keys are plain `UUID` fields with
  **no `@ManyToOne`**, enums are `@Enumerated(STRING)`, and `CurrencyConverter` / `ZoneIdConverter`
  handle the two value types.
- **A new tenant-scoped entity must implement `TenantOwned`** — that is the type the guard in
  `tenant/TenantContext` actually checks, so an entity that merely *has* a `businessId` is not
  protected by it.

## The web layer

Controllers return MapStruct-mapped DTOs, never entities, and `common/mapping/MapperConfig` sets
`unmappedTargetPolicy = ERROR`, so a new DTO field with no source is a compile error rather than a
silent null. `ProcessorSmokeMapper` exists only to fail loudly if annotation processing stops running
at all — don't delete it as dead code. A raw Spring `Page` is never returned; use
`common/web/PageResponse`.

Errors all funnel through `common/error/Problems` and `ProblemDetailWriter`, including the ones
raised inside the filter chain: `ProblemAuthenticationEntryPoint` and `ProblemAccessDeniedHandler`
exist so that the 401 and 403 Spring Security would otherwise write itself are not the only two
responses in the API a client cannot parse. `FilterChainProblemBodyTest` compares those bodies
strictly.

Two filters, both in `common/web`: `RequestCorrelationFilter` (the `X-Request-Id` echoed to the
caller and put in the log MDC — a reported 500 is one grep) and `RateLimitFilter`.

## Security

The public allowlist in `SecurityConfig` is **enumerated, not `/api/auth/**`**: `/me` needs a caller,
and a prefix rule would leave it anonymous while still looking correct. Everything else is
`authenticated()`, and roles are checked by `@PreAuthorize` next to the method, because "OWNER, or
STAFF acting on themselves" is not expressible as a URL pattern.

`POST /api/auth/logout` **is** on the public list deliberately. Behind `authenticated()`, sign-out
breaks exactly when it is needed: fifteen minutes into a forgotten tab the access token is gone, the
client still holds a seven-day refresh cookie, and logout would 401 without the controller ever
running — so the credential that actually matters could not be revoked by the client holding it. The
refresh token in the request is itself the proof of possession.

## Tests

Which base class to extend is the decision to get right:

| Need | Extend / annotate | Cost |
|---|---|---|
| Pure logic — the engine, buffers, policy windows | plain JUnit 5, no Spring | milliseconds |
| Status codes, validation messages, the problem body | `@WebMvcTest` + `support/WebSliceConfig` | fast |
| Schema, constraints, transactions | `support/IntegrationTest` | shares the one container |
| Anything through MockMvc **with the real filter chain** | `support/ApiIntegrationTest` | same context |
| A new admin endpoint's tenant isolation | `support/CrossTenantTestBase` | same context |

Add a per-class `@TestConfiguration` or an extra mock bean only when you mean it: each distinct
context configuration **forks the Spring context cache** and pays for a whole extra application
context. `ApiIntegrationTest` already provides MockMvc with the security chain applied plus three
recorders (`RecordingNotificationService`, `RecordingBookingEvents`, `RecordingCheckoutSessions`) for
exactly this reason.

A `@WebMvcTest` slice does **not** load `@Configuration` classes (so Boot's default chain 401s
everything) but **does** register `Filter` beans (so `RateLimitFilter` is present and needs
collaborators). `WebSliceConfig` fixes both, with limiting off — a bucket shared across a class makes
one test's outcome depend on how many requests the previous one made.

**Container reuse is on**, so the database is not empty between local runs. Therefore: every test
creates its own tenant and asserts only on rows it inserted. **No test may count rows in a whole
table or assume an empty database.** (`aBusiness()` generates a unique slug and each user a unique
email for this reason.) Reuse needs `testcontainers.reuse.enable=true` in
`~/.testcontainers.properties` and is ignored in CI, so the suite has to be correct both ways.

**Time is pinned, never real.** `support/MutableClock` is the primary `Clock`; `TestTime.NOW` is
Monday 2 March 2026 09:00 UTC — a Monday because that is where a weekly template starts, March
because Europe/Paris changes to summer time weeks later. A test jumps the clock forward and calls the
sweeper directly; the token sweep and the booking expiry sweep are **disabled for the whole suite**
precisely so that which test loses its fixture does not depend on the hour the build ran. Rate
limiting is off for every integration test.

`TestHygieneTest` scans all of `src/test` and fails the build on a wall-clock read or a
`Thread.sleep`. Concurrency uses `CountDownLatch` and asserts the outcome *pair* —
`BookingConcurrencyIT` expects one 201, one 409, one row.

Fixtures are builders from `support/fixtures/Fixtures` (one static import, every builder starting
from a valid boring default, so `withBuffers(10, 10)` is visibly a test about buffers).
`support/QueryCounter` is the Hibernate statement counter behind `AvailabilityQueryCountIT`'s
seven-statement pin.

Three meta-tests guard the guards: `CoverageGateTest` asserts the two JaCoCo package names still
match something (a rule naming a vanished package silently checks nothing), `FixturesTest` covers the
builders, and `EnvironmentDocumentationTest` is described above.

### Test JVM configuration lives in the POM

`JWT_SECRET` is environment-only by design, so the test JVMs get a throwaway key from surefire's and
failsafe's `argLine`, alongside `app.security.bcrypt-strength=4` (12 in production; strength 12 turns
a suite that signs in a hundred times into twenty-five seconds of key stretching) and
`-Duser.language=en -Duser.country=US`.

The locale **has to be a JVM argument, not a `systemPropertyVariable`**: `Locale.getDefault()` is
resolved during JVM startup, before those apply, and bean-validation messages ("must not be blank")
are asserted literally by the problem-detail contract test — without the pin the suite passes on an
English machine and fails on a French one.

**Do not add `src/test/resources/application.yml`.** It would shadow the real one, which is why
these values are passed as JVM arguments instead.

JaCoCo uses one exec file for both phases with `append`, and the plugin is declared **after** failsafe
on purpose — within a phase Maven runs plugins in POM order, and `report` has to see the file
`failsafe:verify` has just finished writing. Swapping the two blocks silently reports unit coverage
only.
