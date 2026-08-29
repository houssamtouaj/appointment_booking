/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The third argument is the prefix filter, and '' disables it. Without it
  // loadEnv returns only VITE_* — which is all the app may read, but this file
  // is Node and reads the same variables to decide how to *serve* the app.
  const env = loadEnv(mode, process.cwd(), '')

  const apiMode = env.VITE_API_MODE || 'direct'
  const apiBaseUrl = env.VITE_API_BASE_URL || 'http://localhost:8081'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // The twin of tsconfig.app.json's `paths`. See the comment there.
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      // `crosssite` serves the SPA from 127.0.0.1 while the API stays on
      // localhost. A bare IP has no registrable domain, so the browser treats
      // that pair as cross-*site* — the deployed topology (Vercel + Render)
      // reproduced on one machine, and the only local way to find out whether
      // the refresh cookie survives `SameSite=None; Secure` before a production
      // URL exists.
      //
      // It needs three things on the API side, and it fails confusingly without
      // any one of them: `REFRESH_COOKIE_SAME_SITE=None`,
      // `REFRESH_COOKIE_SECURE=true` (the app refuses to start with None and
      // Secure=false), and `http://127.0.0.1:5173` added to
      // `CORS_ALLOWED_ORIGINS`.
      host: apiMode === 'crosssite' ? '127.0.0.1' : 'localhost',
      proxy: apiMode === 'proxy' ? apiProxy(apiBaseUrl) : undefined,
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      css: true,
      // Vite treats every file under the root as a candidate; without this, a `dist/` left over
      // from a previous build gets collected and the suite fails on minified output.
      //
      // `e2e/**` is excluded for a different reason: those specs are Playwright's, and
      // Vitest's default `include` matches `*.spec.ts` as happily as `*.test.ts`. Collected
      // here they fail on the import of @playwright/test rather than on anything true.
      exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    },
  }
})

/**
 * `proxy` mode: the dev server forwards `/api`, so the browser makes a
 * same-origin request and CORS, preflight and third-party-cookie rules all stop
 * applying. That is the point and also the warning — it hides three of the
 * things production depends on, which is why `direct` is the default.
 *
 * **No `rewrite`.** The refresh cookie is scoped `Path=/api/auth`
 * (`RefreshTokenCookie`), so a proxy that strips or renames the prefix detaches
 * the cookie from the two endpoints that read it. The browser then sends the
 * cookie on nothing, `/refresh` 401s, and the symptom is "sessions randomly
 * die" rather than anything resembling a path bug. The path must arrive at the
 * API exactly as it left the browser.
 */
function apiProxy(target: string): Record<string, ProxyOptions> {
  return {
    '/api': {
      target,
      // The Host header becomes the target's. Safe for the cookie because the
      // API sets no `Domain` attribute, so the browser scopes it to the origin
      // it actually talked to — which in this mode is the dev server.
      changeOrigin: true,
    },
  }
}
