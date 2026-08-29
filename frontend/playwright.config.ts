import { defineConfig, devices } from '@playwright/test'

/**
 * One spec, one browser, against the real stack (F11).
 *
 * The point of this suite is the thing the unit tests deliberately cannot cover:
 * that the availability engine, the exclusion constraint and four screens agree
 * with each other over a real database. Everything else — copy for each error
 * code, the five booking statuses, the polling schedule — is asserted far more
 * cheaply in Vitest against fixtures, and duplicating any of it here would buy a
 * slower, flakier copy of a test that already exists.
 *
 * It expects `docker compose up` from the repository root, with the `demo`
 * profile seeded and **payments off**, which is what the deployed demo runs.
 */
const API_URL = process.env.VITE_API_BASE_URL ?? 'http://localhost:8081'
/**
 * 5173, which is `vite preview`'s default of 4173 deliberately overridden.
 *
 * The API's `CORS_ALLOWED_ORIGINS` defaults to `http://localhost:5173` — the dev
 * server's port — and this run is in `direct` mode on purpose, so every request
 * the page makes is cross-origin and subject to it. Served from 4173 the browser
 * refuses the preflight, the landing page renders its error state, and the spec
 * fails at "no heading" with nothing on screen to explain why. Borrowing the
 * port the stack already trusts keeps `docker compose up && npm run e2e` a
 * two-command story with no .env edit in between.
 */
const WEB_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  // The spec books a real slot and cancels it again. Two workers racing over one
  // seeded database is a self-inflicted 409, and the whole point of this run is
  // that a 409 means something.
  workers: 1,
  fullyParallel: false,
  // A booking that half-succeeded is not something to retry blindly: the retry
  // would meet its own row. Failures here are meant to be read.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: WEB_URL,
    /*
     * Pinned, and load-bearing rather than tidy. A slot chip's accessible name
     * is "12:15, Saturday 26 September" — a clock and a date formatted in the
     * *browser's* locale — so the string this spec has to look for depends on
     * the machine it runs on. Fixing the locale lets it build that name exactly,
     * with `Intl` on both sides agreeing, instead of guessing at it with a
     * regular expression that is really a guess about ICU.
     */
    locale: 'en-GB',
    trace: 'retain-on-failure',
    // The one screenshot worth keeping is the one of the screen that failed.
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * The built bundle, not the dev server.
   *
   * `vite preview` serves exactly what `npm run build` produced, which is what
   * Vercel serves. The dev server would additionally exercise HMR, the React
   * refresh runtime and unminified sources — none of which ships — and would
   * hide a build-time failure such as an environment variable that is inlined
   * wrong.
   */
  webServer: {
    command: 'npm run build && npm run preview -- --port 5173 --strictPort',
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_API_BASE_URL: API_URL,
      // `direct`, so the browser really does make a cross-origin request and
      // CORS is exercised. The proxy mode would hide the one thing this run is
      // uniquely placed to catch.
      VITE_API_MODE: 'direct',
    },
  },
})
