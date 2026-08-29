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
root). Nothing in the app calls it yet — that starts in wave 2.

| Script                 | What it does                                    |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Vite dev server                                 |
| `npm run build`        | Production bundle into `dist/`                  |
| `npm run preview`      | Serve that bundle                               |
| `npm run typecheck`    | `tsc -b` across the app, node and test projects |
| `npm run lint`         | ESLint, zero warnings tolerated                 |
| `npm run test`         | Vitest once                                     |
| `npm run test:watch`   | Vitest in watch mode                            |
| `npm run format`       | Prettier, write                                 |
| `npm run format:check` | Prettier, check only — what CI runs             |

`.github/workflows/web.yml` runs typecheck, lint, format, test and build on every push
that touches `frontend/`, plus a grep asserting that every `VITE_*` the code reads is
documented in `.env.example`. It is deliberately **not** a required check on `main`; the
header comment in that file explains what has to change before it can be.

## Source layout

| Directory            | Responsibility                                                     |
| -------------------- | ------------------------------------------------------------------ |
| `styles/`            | `theme.css` — the design tokens, and the reasoning behind them     |
| `api/`               | Axios instance, refresh-token interceptor, typed endpoint wrappers |
| `types/`             | TypeScript types mirroring the API DTOs                            |
| `components/ui/`     | shadcn/ui primitives                                               |
| `components/`        | Shared presentational components                                   |
| `hooks/`             | Reusable hooks (TanStack Query wrappers, media queries)            |
| `lib/`               | date-fns/date-fns-tz helpers, formatters, Zod schemas              |
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

## Not built yet

No API call, no Axios, no TanStack Query, no real screen — every route renders a
placeholder. That starts in wave 2.
The screen list is tracked in the local project brief (see `docs/`, not committed).
