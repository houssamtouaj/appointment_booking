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

`.github/workflows/web.yml` runs typecheck, lint, format, test and build on every push
that touches `frontend/`, plus a grep asserting that every `VITE_*` the code reads is
documented in `.env.example`. It is deliberately **not** a required check on `main`; the
header comment in that file explains what has to change before it can be.

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

## Not built yet

No business data, no public booking page, no calendar. `/dashboard` and the other admin
routes are still wave-1 placeholders — what changed in wave 2 is who is allowed to see
them. The screen list is tracked in the local project brief (see `docs/`, not committed).
