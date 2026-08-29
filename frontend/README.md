# SlotFlow — Frontend

React 19 + TypeScript + Vite single-page app. A pure consumer of the backend REST
API — it holds no domain rules of its own. Availability, conflict detection and
policy enforcement all live server-side; the client renders what the API returns.

## Getting started

```sh
cp .env.example .env.local     # nothing in it is secret; Vite inlines it into the bundle
npm ci
npm run dev                    # http://localhost:5173
```

The API is expected on `http://localhost:8081` (`docker compose up` from the repository
root, with `SPRING_PROFILES_ACTIVE=demo` so that `POST /api/auth/demo-login` exists).

| Script                   | What it does                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`            | Vite dev server                                                                                                       |
| `npm run build`          | Production bundle into `dist/`                                                                                        |
| `npm run preview`        | Serve that bundle                                                                                                     |
| `npm run typecheck`      | `tsc -b` across the app, node and test projects                                                                       |
| `npm run lint`           | ESLint, zero warnings tolerated                                                                                       |
| `npm run test`           | Vitest once                                                                                                           |
| `npm run test:watch`     | Vitest in watch mode                                                                                                  |
| `npm run format`         | Prettier, write                                                                                                       |
| `npm run format:check`   | Prettier, check only — what CI runs                                                                                   |
| `npm run contract:check` | Diff the Zod schemas against the running API's `/v3/api-docs`. Local only — it needs the stack up, so it is not in CI |
| `npm run e2e`            | Playwright: the booking flow end to end against `docker compose up`                                                   |
| `npm run e2e:install`    | Fetch the Chromium build `npm run e2e` drives. Once per machine                                                       |

`.github/workflows/web.yml` runs typecheck, lint, format, test and build on every push
that touches `frontend/`, plus a grep asserting that every `VITE_*` the code reads is
documented in `.env.example`. It is deliberately **not** a required check on `main`; the
header comment in that file explains what has to change before it can be.

`.github/workflows/e2e.yml` runs the Playwright spec, and **only on pushes to `dev` and
`main`** — it builds the backend image, waits for a database and drives a browser, which is
six or seven minutes against web.yml's ninety seconds. Locally it wants the stack up:

```sh
docker compose up            # from the repository root
npm run e2e:install          # once per machine
npm run e2e
```

## Source layout

| Directory            | Responsibility                                                     |
| -------------------- | ------------------------------------------------------------------ |
| `styles/`            | `theme.css` — the design tokens, and the reasoning behind them     |
| `api/`               | Axios instance, refresh-token interceptor, typed endpoint wrappers |
| `api/schemas/`       | Zod schemas — the source of truth for the contract, hand-written   |
| `types/`             | `z.infer` of those schemas, nothing hand-written                   |
| `components/ui/`     | shadcn/ui primitives                                               |
| `components/`        | Shared presentational components                                   |
| `hooks/`             | Reusable hooks (TanStack Query wrappers, media queries)            |
| `lib/`               | date-fns/date-fns-tz helpers, formatters, the single `env` read    |
| `pages/`             | Route-level components wired to React Router                       |
| `features/auth`      | Login, demo-admin shortcut, token refresh handling                 |
| `features/booking`   | Public flow: service → staff → slot → details → confirm            |
| `features/calendar`  | Admin week/day calendar, booking detail drawer                     |
| `features/services`  | Services CRUD                                                      |
| `features/staff`     | Staff list, working-hours grid, exceptions calendar                |
| `features/dashboard` | Today's bookings, week count, revenue, no-show rate                |
| `features/settings`  | Timezone, deposit rules, booking policy                            |

`src/routes.tsx` holds the whole route table. Three of its paths — `/booking/:cancellationToken`,
`/reset-password/:token` and `/accept-invitation/:token` — are named by the backend and
built into outbound mail, so they are not ours to rename.

## Rules this side of the boundary enforces

1. **Server state lives in TanStack Query**, never duplicated into local state.
2. **Times arrive as UTC ISO strings** and are formatted for display with
   `date-fns-tz` using the business or browser timezone. Never send local times.
3. **A `409` from the booking endpoint is an expected outcome**, not a crash —
   the slot was taken while the user was filling the form. Refetch and explain.
4. **Every mutation gets a toast**; status changes update optimistically.
5. **Every colour, radius and duration comes from a token** in `src/styles/theme.css`.
   No literal hex or `ms` value in a component — `src/styles/theme.test.ts` enforces it.
6. **A slot's day and hour are the business's, never the viewer's.** Every read goes
   through `src/lib/time.ts`; `new Date(iso).getDay()` in a component is a bug, not a
   shortcut. `src/lib/time.test.ts` passes identically under any `TZ`.
7. **Prices are formatted only by `src/lib/money.ts`**, which divides by the currency's
   own minor units rather than by 100 — JPY has none — and never through a `double`.

## Design system

`src/styles/theme.css` is the whole visual language and carries the reasoning inline.
The short version: the direction is _the appointment book_ — warm paper neutrals rather
than shadcn's cool slate, a green-ink accent that marks only two things (a free slot and
the action that takes it), a condensed signage face for display and IBM Plex for
everything else, a radius scale with a job per step, and one motion duration.

Dark mode is token-level. Tokens are defined on `:root`, overridden under
`:root[data-theme='dark']` and again under `prefers-color-scheme: dark` guarded by
`:root:not([data-theme='light'])`, so the toggle cycles system → light → dark and
"light" wins on a dark-set OS. A blocking inline script in `index.html` stamps the
stored choice before first paint; without it a hard reload in dark mode flashes white.

## Quality bar

Skeleton loaders over spinners · empty states with a next action · full keyboard
navigation with real focus states · works at 375px · dark mode.

There is no generic full-page loader and no shared spinner, deliberately. `Skeleton` is
an atom; each surface composes its own skeleton so the placeholder holds the geometry of
the content it replaces and the page does not reflow when data lands.

## The API client

`src/api/client.ts` is the one Axios instance. `withCredentials: true` in every mode,
because the refresh cookie is not sent without it, and no path in `baseURL` — the cookie
is scoped `Path=/api/auth`, so anything that rewrites that prefix detaches it and the
symptom is "sessions randomly die" rather than a path bug.

**The access token lives in a module variable and nowhere else.** Not `localStorage`, not
a readable cookie. The refresh token is in an httpOnly cookie the browser attaches to
`/api/auth/refresh` and `/api/auth/logout` only; the whole point of that design is that an
XSS bug cannot exfiltrate a seven-day credential, and putting the fifteen-minute one in
storage gives most of it back.

On a 401 the interceptor joins a **single in-flight refresh promise** and replays the
original request once. The single flight is the wave's reason for existing: the backend
rotates on every refresh and treats a re-presented token as theft, so six queries that all
401 at once would fire six refreshes, five of which come back `401 REFRESH_REUSED` and
revoke the chain — signing the user out at the exact moment the code was trying to keep
them in. `src/api/client.test.ts` asserts one refresh for three concurrent 401s, no
recursion when `/refresh` itself 401s, and one replay rather than two.

The two sign-in paths are the exception. `/api/auth/login` and `/api/auth/demo-login`
carry a credential rather than the access token, so their 401 means _refused_, not
_expired_, and the interceptor hands it straight back. Rotating there would spend a refresh
on every mistyped password — out of the `PUBLIC_WRITE` bucket `RateLimitFilter` shares with
public booking writes, since login has its own scope — and, for a visitor who still held a
live refresh cookie, would consume and then end the session the failed sign-in had nothing
to do with. `demo-login` needs the same treatment for a non-obvious reason: without the
`demo` profile the path is refused by the filter chain with a 401, not a 404 from the absent
controller, so the screen reads the sign-in button that failed rather than the status code
to decide whether to say "wrong password" or "this deployment has no demo profile".

`REFRESH_REUSED` gets its own sentence — "You were signed out because your session was
used from somewhere else" — because it means something different from an expiry, and a
generic "session expired" would hide a security event behind routine copy.

### Three dev modes

`VITE_API_MODE` picks how the dev server reaches the API. `direct` is the default because
it is the only one that exercises CORS, `allowCredentials` and `withCredentials`, all
three of which production depends on and the proxy hides. `proxy` makes everything
same-origin for debugging something that is not CORS. `crosssite` serves the SPA from
`127.0.0.1:5173` against `localhost:8081` — a bare IP has no registrable domain, so the
browser treats the pair as cross-_site_, which is the deployed Vercel + Render topology
reproduced locally. `.env.example` documents what the API needs restarted with for that
last one.

### Known gap: request ids are cross-origin invisible

Every API response carries `X-Request-Id`, and `ErrorState` and `FormAlert` show it so a
person reporting a failure has something to quote. They mostly will not have one:
`CorsConfig.setExposedHeaders` lists `Location, Retry-After` and not `X-Request-Id`, so
cross-origin JavaScript cannot read it — which is `direct`, `crosssite` and the deployed
pair. The body carries `requestId` on 5xx only, by deliberate backend design, so a 4xx
cross-origin has no id at all. Adding `"X-Request-Id"` to that list is a one-line backend
change and is not ours to make; until then the UI omits the reference line rather than
showing a blank.

## The public booking flow

`/b/:slug` is the landing page and `/b/:slug/book` is the flow: service → who → when.
Both are anonymous; neither needs a token.

**Flow state lives in the URL**, not in a context: `?service=&staff=&date=`. The back
button walks the steps, a pasted link reopens the same service, person and week, and the
wave-4 booking failure can send someone back to the slot picker with everything else
intact — which a context loses on the navigation that gets them there. The current step
is _derived_ from those parameters, so a step marker cannot disagree with the choices
beside it, and there is no way forward past an unmade choice.

**"Anyone" is the default and the first option**, because it finds the most slots.
Choosing it omits `staffId` from the request entirely rather than sending an id lifted
from a slot's `staffIds` — that field is the union of who _could_ take the slot, and
sending one back removes the server's ability to balance the work. A service with exactly
one eligible person skips the step instead of asking a question with one answer.

**Times.** One week per request, `from` the displayed Monday and `to` its Sunday, with
`tz` set to the _business's_ zone (F8) — the same zone every time on screen is rendered
in, because framing days in one zone while drawing headings for another disagrees by a
day at the edges. The range cap is 62 days **inclusive of both ends**, so `from + 62` is
63 and a 422; `fetchAvailability` rejects that before the network.

**Slot starts are not aligned to the clock.** The engine walks its grid from each opening
window rather than from the hour, so the demo returns `:05`, `:10` and `:35` starts.
Nothing rounds or bins them.

**Keyboard.** The slot grid is a roving tabindex per day: arrows move within a day, Tab
moves to the next day, Enter selects. A week can be 163 slots, and one tab stop each
would put them all between the picker and the button below it.

**The empty week does work.** There is no next-available endpoint, so "Find the next
opening" issues one widened request — today across 60 days, inside the cap — and jumps to
the first day with anything. `minLeadTimeHours` and `maxAdvanceDays` are on no public
endpoint, so no copy quotes a number of days: the client asks wide and the server trims.

### Known gap: the public payload has no contact details

When a business has nothing bookable in its whole window, the right thing to offer is a
way to contact it. `PublicBusinessResponse` carries slug, name, timezone, currency, the
two deposit fields, opening hours and services — and no phone, address or email. So that
empty state says so plainly and points at the opening hours instead of inventing a
number. Adding a field is a backend change and deliberately not made here.

### Deposit copy is conditional, and that is not fussiness

`depositRequired` on the landing payload is the **raw** business setting.
`PublicBusinessService` maps `business.requiresDeposit()`, and only `PublicBookingService`
ANDs it with `payments.enabled()` — so the demo reports `true` and then confirms every
booking with no deposit taken. The landing page may say a deposit _may_ be requested; only
the booking response says one _is_. Asserting otherwise is a gate failure.

## Booking, the deposit and the manage page

Step 4 is `?slot=<the slot's start, verbatim>`. Adding it to the URL rather than to a
context is what makes the `409` recovery free: the flow page survives a query-string
change, so **the details form is declared there and simply outlives the step**. Returning
someone to the picker is one parameter being cleared, with nothing to serialise and
nothing to restore.

**Six refusals, six screens.** The booking endpoint fails in ways that mean different
things and lead to three different places, so every one is keyed on `ApiError.code` and
has copy of its own (`booking-errors.ts`). The two that carry a boundary —
`POLICY_LEAD_TIME` and `POLICY_MAX_ADVANCE` — read `earliestStart` / `latestStart` out of
the problem body and reopen the picker on that week, which is why `problemDetailSchema` is
a **loose** object: Zod's default strips unknown keys, and a strict one parses those
bodies happily and throws the useful half away.

**`409 BOOKING_SLOT_TAKEN` is the expected outcome, not a crash.** It is what the whole
double-booking guarantee produces when two people want the same 10:00, and the second
person's entire experience of that guarantee working is one sentence. It reads as an
ordinary thing that happened, and the contact details survive it.

**The response decides whether a deposit is taken, and nothing else does** (F5). A
`CONFIRMED` with no `checkoutUrl` is a finished booking; a `PENDING` with one is a hold.
`depositRequired` on the landing payload is the raw business setting — only
`PublicBookingService` ANDs it with `payments.enabled()` — so the demo reports `true` and
then confirms every booking with nothing to pay. No screen before the `201` may promise
otherwise.

The deposit path shows the hold from `expiresAt` and the words "not refunded" before
handing off with `window.location.assign` — a full navigation, because Checkout is
Stripe's domain. `expiresAt` is **absent on a confirmed booking** (nulls are omitted), so
`HoldNotice` renders nothing without one rather than counting down to `NaN`.

The cancellation token goes to `sessionStorage` immediately before that navigation and
nowhere else. Not `localStorage`: `sessionStorage` dies with the tab, which is exactly the
lifetime of a redirect round trip, and a token that outlives the tab is somebody else's
appointment on a shared machine. It is the one credential in this app that reaches storage
at all — unlike the access token it is not a key to an account, it _is_ the customer's own
booking, and it is already in their inbox.

### `/booking/:cancellationToken`

**A redirect is not a payment.** `?checkout=success` and `?checkout=cancelled` choose the
tone of one sentence and nothing else; the page reads the booking either way, because the
redirect is something a browser did and the payment is something a webhook confirmed.
Anyone can type that URL. While the booking says `PENDING` the page asks again — every two
seconds, backing off to five, for at most ninety, then a manual "Check again" — and the
interval belongs to the query observer, so unmounting the route tears it down.

Cancelling states that deposits are not refunded (backend D7) **before** the button.
`409 CANCELLATION_CUTOFF` is a designed state rendered inside the dialog with the deadline
that passed, not a toast: it is an answer to the question the dialog just asked.
`cancellable: false` disables the button and says why, using `cancellationDeadline` — a
missing control leaves "can I cancel this?" unanswered. A cancelled booking still resolves
at its token forever and renders as cancelled, never as a 404.

### Known gap: the manage page cannot know the business

`PublicBookingResponse` carries the two instants, the price, the currency, the token and
the guest — and no business at all: no slug, no name, no `timezone`. So this is the one
screen in the app that renders times in the **viewer's** zone rather than the business's,
and it names the zone in a line underneath. Guessing UTC would put a 01:40 Paris
appointment on the wrong day for its own customer; the honest degradation is the reader's
own clock, labelled. It is also why the cancelled state offers no prefilled "book again"
link — there is no slug to build one from. Adding `businessSlug` and `timezone` to that
response is a backend change and deliberately not made here.

## Not built yet

`/dashboard` and the other admin routes are still wave-1 placeholders — the business
cannot see these bookings yet, and there is no `POST /api/bookings` for it to create one
either way. The screen list is tracked in the local project brief (see `docs/`, not
committed).
