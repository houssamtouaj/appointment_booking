# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The SlotFlow SPA: React 19 + TypeScript + Vite 8 + Tailwind 4, deployed to Vercel, talking to the
Spring Boot API in `../backend` over nothing but HTTP.

`../CLAUDE.md` carries the cross-cutting rules and everything about the API contract's server side;
it is loaded alongside this file and is not repeated here. `README.md` in this directory is the
design record for the decisions below — read the relevant section before changing behaviour it
describes, and update it when you do. The `F<n>` identifiers scattered through the source
(`F1`–`F19`) resolve in `docs/plans/frontend/00-overview.md`, which is **not in git**; on a fresh
clone they are dead references.

## Commands

```bash
npm run dev                            # http://localhost:5173
npm run typecheck                      # tsc -b over four projects: app, node, test, e2e
npm run lint                           # eslint, --max-warnings 0
npm run format:check                   # what CI checks; `npm run format` fixes
npm run test                           # vitest run
npm run test -- src/lib/time.test.ts   # one file
npm run test -- -t 'rejects a 4xx'     # one case by name
npm run test:watch                     # vitest in watch mode
npm run build                          # vite build; CI runs it, so it has to pass
npm run contract:check                 # diff the Zod schemas against a running API's /v3/api-docs
npm run e2e                            # Playwright; `npm run e2e:install` once, first
```

`contract:check` and `e2e` both need `docker compose up` from the repository root. Neither is a
required check: `contract:check` is local-only by design (a gate that depends on a service being up
goes red for reasons unrelated to the commit) and `e2e.yml` runs only on `dev` and `main`.

`npm run e2e` builds the bundle and serves it with `vite preview` on **5173**, not Playwright's
4173, because the API's `CORS_ALLOWED_ORIGINS` defaults to the dev-server port and the run is
deliberately in `direct` mode. It expects the `demo` profile seeded with payments off, runs one
worker with no retries, and pins `locale: 'en-GB'` — slot chips are matched by their formatted
accessible name, so the locale is load-bearing.

## Environment

`src/lib/env.ts` is the **single read of `import.meta.env`**. Vite inlines these at build time, so
the same variable read in three components is three independently-defaulted literals in the bundle.
Add a variable there, with its default and the reason, and nowhere else.

- `VITE_API_BASE_URL` — origin only, **no path**. `API_ORIGIN` is what Axios gets and is not the
  same value (see the modes below). Baked at build time, which makes deploying a three-step
  handshake (F18): build against the Render URL, set `CORS_ALLOWED_ORIGINS` and `FRONTEND_BASE_URL`
  on Render to the resulting Vercel URL, then redeploy the API.
- `VITE_API_MODE` — `direct` (default), `proxy`, `crosssite`. **`direct` is the awkward default on
  purpose:** it is the only local mode that exercises CORS, `allowCredentials` and
  `withCredentials`. `proxy` makes Vite forward `/api` same-origin, which hides all three — reach
  for it to debug something else. `crosssite` serves the SPA from `127.0.0.1:5173` against
  `localhost:8081`; a bare IP has no registrable domain, so that pair is cross-_site_, and it is the
  only local way to prove the refresh cookie survives `SameSite=None; Secure`. It needs the API
  restarted with `REFRESH_COOKIE_SAME_SITE=None`, `REFRESH_COOKIE_SECURE=true` (the app refuses to
  start with `None` and `Secure=false`) and `http://127.0.0.1:5173` in `CORS_ALLOWED_ORIGINS`.
- `VITE_DEMO_SLUG` — the business `/` redirects to (F16). No endpoint lists businesses.

**The dev proxy has no `rewrite` and `baseURL` has no path.** The refresh cookie is scoped
`Path=/api/auth`; any prefix rewrite detaches it, `/refresh` 401s, and the symptom reads as
"sessions randomly die" rather than as a path bug. Every call site passes the full `/api/...` path.

Local config goes in `.env.local` (gitignored). `web.yml`'s last step greps `src/`,
`vite.config.ts` and `index.html` for `VITE_[A-Z0-9_]+` and **fails the build if one is not
documented in `.env.example`** — the frontend's twin of the backend's `EnvironmentDocumentationTest`.
Nothing in `.env.example` may be a secret: every `VITE_*` ships to the browser in readable form.

## Layout

```
src/api/            one Axios instance, one error type, the Zod schemas, the query-key factories
src/api/schemas/    hand-written source of truth for the contract (F3/F4)
src/features/<x>/   a screen and everything only it uses, including <x>-queries.ts
src/components/     shared pieces; components/ui/ is shadcn's generated atoms
src/hooks/          cross-feature hooks (auth, theme, media query, unsaved changes, lookups)
src/i18n/           en.ts, fr.ts and the typed t() — the fourth enforced monopoly
src/lib/            time.ts, money.ts, env.ts, utils.ts — the things with enforced monopolies
src/styles/         theme.css: the entire visual language, plus the test that guards it
src/types/          nothing hand-written; every export is a z.infer re-export
e2e/                Playwright, one spec, against the real stack
```

## The API layer

`src/api/client.ts` is the one instance, `withCredentials: true` always. Its response interceptor is
five numbered rules and each has a test in `client.test.ts` named after the failure it prevents —
read the rules before touching it. The two that catch people out: a 401 from `/login` or
`/demo-login` means _refused_, not _expired_, so nothing is refreshed and no session is ended; and a
401 whose refresh then fails rethrows the **original** error with the refresh failure as `cause`,
because the screen's copy comes from the original `code`.

- The access token lives in a module variable in `src/api/session.ts` — never `localStorage`,
  `sessionStorage`, or a readable cookie. A wave gate dumps both stores and asserts it is absent.
- `src/api/bootstrap.ts` holds the cold-load restore (one refresh, then one `me`) in a
  **module-scope promise**. A `useRef` guard does not survive the `StrictMode` double mount.
- `ApiError` (`src/api/error.ts`) is the only error shape. Branch on `code`, never on `detail` —
  the backend reserves the right to reword prose. `isApiError(e, 'SLUG_TAKEN')` is the usual form;
  `applyFieldErrors` feeds a 422's `errors[]` into react-hook-form; `status === 0` is a request that
  never got an answer.
- `src/api/error-copy.ts` maps a `code` to a sentence, with per-screen overrides. A code with no
  entry falls back to the server's `detail`, deliberately: the failure being prevented is a screen
  showing a raw enum name.
- Schemas are hand-written because springdoc types `Currency` as `object` while the wire format is
  `"EUR"` — a generated client would be wrong at runtime. The price of that choice is drift, and
  `contract:check` is the payment; `src/api/schemas/registry.ts` tells it which Zod object claims
  which `components.schemas` entry, and every new schema pair belongs in that map.
- Screens import types from `@/types`. `@/api/schemas` is only for code that needs the runtime
  schema object itself.

## Queries

`src/api/<resource>.ts` holds the endpoint functions **and** that resource's key factory
(`bookingKeys`, `publicKeys`, `serviceKeys`, `availabilityKeys`, `referenceKeys`, …).
`src/features/<x>/<x>-queries.ts` holds the hooks that consume them. A query key is never written
inline at a call site, and invalidation goes through the factory's `all`/`*All` members.

Defaults are decided once in `createQueryClient()` and no feature restates them: `shouldRetry` never
retries a 4xx but does retry a 5xx and `status === 0`; `staleTime` 30 s; `refetchOnWindowFocus` off,
because most screens are forms and a refetch under a half-filled one either discards or fights what
was typed — the calendar and dashboard override it. Mutations never retry, since an auto-retried
booking is how a double booking gets made. `createQueryClient()` is a factory: a shared cache is what
makes a test pass alone and fail in the suite. `App.tsx` holds it in `useState`, and the provider
order (`QueryClientProvider` → `AuthProvider` → router) is the one order that works.

## Rules enforced by tests, not review

- **Tokens.** `styles/theme.test.ts` scans every non-test `.ts`/`.tsx` under `src/` and fails on a
  literal colour (`#hex`, `rgb(`, `hsl(`, `oklch(`), an arbitrary font size (`text-[…]`) or a
  literal duration (`160ms`, `duration-[…]`). Everything comes from `src/styles/theme.css`, whose
  header records the visual direction and names the three looks rejected on purpose — if you are
  about to add a blue or a chroma-free grey, that file is what exists to stop you. The same test
  asserts the two dark blocks (`[data-theme='dark']` and `prefers-color-scheme`) override the same
  tokens to the same values, and that `index.html`'s pre-paint script and `use-theme.ts` agree on
  the `slotflow-theme` storage key.
- **Time.** Every date read goes through `src/lib/time.ts`, and `time.test.ts` passes under any
  `TZ`. A slot's day and hour are properties of the **business**, not the viewer:
  `new Date(iso).getDay()` files a 01:40 Paris slot under the wrong day in London. Use `dayKeyOf`,
  `clockOf`, `hourOf`, `weekOf`, `groupSlotsByDay`, `addDays` — a `DayKey` (`yyyy-MM-dd`) is pure
  calendar arithmetic once it exists. The file formats with `formatInTimeZone`, never
  `toZonedTime`, which reconstructs through a system-zone `Date` and lands an hour out across a
  local DST gap. `MAX_RANGE_DAYS = 62` counts both ends; 63 days is a 422 on `to`.
- **Money.** Only `src/lib/money.ts` formats a price. It divides by the currency's own minor units
  (JPY has 0, BHD has 3), matching the backend's `Money.java`, and scales with string surgery so no
  `double` ever touches a price.
- **Language.** Every string the app writes itself lives in `src/i18n/en.ts`, and `fr.ts` is
  constrained to its shape by `Same<typeof en>` — a missing French key is a `tsc` failure, not an
  English sentence in a French page (F21). `no-hardcoded-strings.test.ts` scans the translated
  surface for literal JSX prose and literal `aria-label`/`placeholder`/`hint`/`title`/`eyebrow`
  props; `i18n.test.ts` asserts both languages use the same `{placeholders}`, which `tsc` cannot
  see; `error-copy.test.ts` walks `errorCodeSchema` and fails on a code with no copy. The chosen
  language is a module store shaped exactly like `use-theme.ts`, including the `slotflow-lang` key
  duplicated in `index.html`'s pre-paint script and the drift test that keeps the two equal.
  `lib/time.ts` and `lib/money.ts` default their `locale` to that store rather than to the browser
  (F23), so no call site passes one. Never build a sentence from two keys, and never wrap prose
  around a `<span>` for emphasis — French word order is not English word order, so one key with
  `{placeholders}` is the only shape that translates. Phase 2 (the admin features) is not done: the
  `TRANSLATED` list in the scan is what says how far the wave has reached.

## Routing and access

The whole table is in `src/routes.tsx` with the reasoning inline. Public booking lives under
`/b/:slug` so a business slugged `login` cannot shadow an admin route; admin routes are bare paths.
`/booking/:cancellationToken`, `/reset-password/:token` and `/accept-invitation/:token` are named by
the backend and built into already-sent mail (F12) — not ours to rename.

`AdminLayout` wraps `RequireAuth`, so the shell with skeleton nav is on screen during the bootstrap
refresh rather than a round trip after it. `RequireOwner` gates services, team and settings — a
change of mind in wave 7, recorded in the file. `team/:id/hours` has **no route guard**: the rule is
"an owner, or the person themselves", which depends on the id in the path, so `HoursPage` makes the
check itself and mirrors `WorkingHoursService.requireOwnerOrSelf`.

Public booking flow state lives in the URL (`?service=&staff=&date=&slot=`), not a context; the
current step is derived from those parameters, which is what makes 409 recovery free.

## Testing

- HTTP is faked by installing a stub `AxiosAdapter` on the shared `client`. There is no msw and
  nothing mocks `@/api`. Stubs must be shaped like the real payload — a lazy one is rejected at the
  Zod boundary and the screen renders its error state, which is the parsing layer working rather
  than a test to loosen.
- Reset module state in `beforeEach`: `resetInFlightRefresh()`, `resetBootstrap()`,
  `endSessionQuietly()`. Those seams exist for tests; nothing in the app calls them.
- Each test builds its own `createQueryClient()`, and most mount the real `routes` inside
  `AuthProvider` and a `createMemoryRouter`.
- Budgets: `testTimeout`/`hookTimeout` 15 s in `vite.config.ts`, `asyncUtilTimeout` 5 s in
  `vitest.setup.ts`. They are separate and neither covers the other — the first means "this hung",
  the second reports "unable to find" with a DOM dump. Both are raised for worker contention, not
  because anything is slow. The setup file also stubs `matchMedia`, which jsdom will never have.
- Vitest's `exclude` names `dist/**` and `e2e/**`: a leftover build gets collected otherwise, and
  Playwright's `*.spec.ts` matches Vitest's default include and fails on its own import.

## TypeScript and lint gotchas

- **The `@/*` alias is declared in three places that never read each other**: `tsconfig.app.json`
  (tsc), `vite.config.ts` (the bundler), and the root `tsconfig.json` — the last only so the shadcn
  CLI resolves it instead of creating a literal `@` directory. Changing one alone gives you a build
  that type-checks and does not bundle, or the reverse.
- **`tsconfig.test.json` must keep `"exclude": []`.** It extends the app project, which excludes
  `*.test.ts*`, and `exclude` filters `include` — without the reset not one test file is
  type-checked by anything, and Vitest does not type-check either, so the error ships.
- `noUncheckedIndexedAccess` is on: `arr[i]` is `T | undefined`. `erasableSyntaxOnly` is on: no
  constructor parameter properties, no enums.
- ESLint is deliberately **not** type-aware — `npm run typecheck` already runs the full compiler.
  `_`-prefixed identifiers are the repo's marker for "deliberately unused".
  `react-refresh/only-export-components` is off for `src/components/ui/**` only, because shadcn's
  atoms export their `cva` variants beside the component. `jsx-a11y` is told in the config which
  local atoms wrap a native control.
- Prettier owns formatting and `eslint-config-prettier` is last in every extends chain.
  `prettier-plugin-tailwindcss` sorts class lists, so `format:check` also catches class-order drift;
  `.gitattributes` pins the relevant extensions to LF because that gate exists.
