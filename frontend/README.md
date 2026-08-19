# SlotFlow — Frontend

React 18 + TypeScript + Vite single-page app. A pure consumer of the backend REST
API — it holds no domain rules of its own. Availability, conflict detection and
policy enforcement all live server-side; the client renders what the API returns.

## Source layout

| Directory | Responsibility |
|---|---|
| `api/` | Axios instance, refresh-token interceptor, typed endpoint wrappers |
| `types/` | TypeScript types mirroring the API DTOs |
| `components/ui/` | shadcn/ui primitives |
| `components/` | Shared presentational components |
| `hooks/` | Reusable hooks (TanStack Query wrappers, media queries) |
| `lib/` | date-fns/date-fns-tz helpers, formatters, Zod schemas |
| `pages/` | Route-level components wired to React Router |
| `features/auth` | Login, demo-admin shortcut, token refresh handling |
| `features/booking` | Public flow: service → staff → slot → details → confirm |
| `features/calendar` | Admin week/day calendar, booking detail drawer |
| `features/services` | Services CRUD |
| `features/staff` | Staff list, working-hours grid, exceptions calendar |
| `features/dashboard` | Today's bookings, week count, revenue, no-show rate |
| `features/settings` | Timezone, deposit rules, booking policy |

## Rules this side of the boundary enforces

1. **Server state lives in TanStack Query**, never duplicated into local state.
2. **Times arrive as UTC ISO strings** and are formatted for display with
   `date-fns-tz` using the business or browser timezone. Never send local times.
3. **A `409` from the booking endpoint is an expected outcome**, not a crash —
   the slot was taken while the user was filling the form. Refetch and explain.
4. **Every mutation gets a toast**; status changes update optimistically.

## Quality bar

Skeleton loaders over spinners · empty states with a next action · full keyboard
navigation with real focus states · works at 375px · dark mode.

## Not built yet

Vite scaffold, Tailwind + shadcn setup, Axios client.
The screen list is tracked in the local project brief (see `docs/`, not committed yet).
