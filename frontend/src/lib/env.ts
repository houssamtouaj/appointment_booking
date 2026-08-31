/**
 * The single read of `import.meta.env`.
 *
 * Vite inlines these at build time, so the same variable read in three components
 * is three independently-defaulted string literals baked into the bundle. Reading
 * each one exactly once, here, is what gives every variable a single documented
 * default — and what keeps web.yml's .env.example grep meaningful, since that
 * scan is deliberately broad enough to match a mention in a comment.
 */

/** Matches the demo tenant seeded by the backend's `demo` Spring profile. */
const DEFAULT_DEMO_SLUG = 'demo-salon'

/**
 * The business the bare `/` route opens (F16). There is no endpoint that lists
 * businesses, so the portfolio link needs a slug it can count on.
 */
export const DEMO_SLUG = import.meta.env.VITE_DEMO_SLUG || DEFAULT_DEMO_SLUG

/**
 * Origin of the API, no trailing slash. Baked at build time (F18), which is what
 * makes deployment a three-step handshake rather than a single deploy.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8081'

export type ApiMode = 'direct' | 'proxy' | 'crosssite'

const API_MODES: readonly ApiMode[] = ['direct', 'proxy', 'crosssite']

function readApiMode(): ApiMode {
  const raw = import.meta.env.VITE_API_MODE
  // Direct is the default on purpose (F2): it is the only mode that exercises
  // CORS, allowCredentials and withCredentials, which is three of the things
  // production needs and the proxy hides.
  return API_MODES.includes(raw as ApiMode) ? (raw as ApiMode) : 'direct'
}

export const API_MODE = readApiMode()

/**
 * The Axios `baseURL`, which is **not** the same thing as `API_BASE_URL`.
 *
 * In `proxy` mode it is the empty string: the dev server forwards `/api` itself,
 * so the browser must issue a same-origin request and prefixing the absolute
 * origin would bypass the proxy entirely and quietly put you back in `direct`.
 *
 * Note what is absent in every mode — a path. The refresh cookie is scoped
 * `Path=/api/auth` (`RefreshTokenCookie`), so a `baseURL` ending in `/api` or
 * `/api/v1`, or a normaliser that adds or strips a trailing slash, detaches the
 * cookie from the two endpoints that read it. The symptom is "sessions randomly
 * die", which is a long way from "path bug". Every call in this app passes the
 * full `/api/...` path.
 */
export const API_ORIGIN = API_MODE === 'proxy' ? '' : API_BASE_URL

/**
 * True in `vite dev`, false in a build. Vite's own flag, not a `VITE_` variable,
 * and read here for the same reason as the rest: one read, one documented
 * meaning.
 *
 * It gates exactly one thing — the line on the invitation dialog that says where
 * to find the mail locally. Outbound mail goes to MailHog in Compose and to a
 * real provider in production, so that sentence is true in development and
 * misleading anywhere else. It is not a feature flag and nothing behavioural
 * hangs off it.
 */
export const IS_DEV = import.meta.env.DEV
