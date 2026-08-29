/// <reference types="vite/client" />

/**
 * Every `VITE_*` the app reads, declared once. `frontend/.env.example` documents
 * the same list for humans, and CI greps one against the other — a variable that
 * appears here and not there is a variable the next person deploys without.
 *
 * All of them are optional at the type level and defaulted in `src/lib/env.ts`,
 * because Vite inlines these at build time: a missing one is `undefined` in the
 * bundle, not a startup error, and the only place that can be handled is where
 * it is read.
 */
interface ImportMetaEnv {
  /** Origin of the SlotFlow API, no trailing slash. Baked at build time (F18). */
  readonly VITE_API_BASE_URL?: string
  /** `direct` | `proxy` | `crosssite` — how dev reaches the API (F2). */
  readonly VITE_API_MODE?: string
  /** Slug the bare `/` route redirects to (F16). */
  readonly VITE_DEMO_SLUG?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
