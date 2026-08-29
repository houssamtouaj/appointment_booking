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
 * Wave 2 owns the API client; these are read here only so that .env.example and
 * `ImportMetaEnv` describe the same set from wave 1 onward.
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
