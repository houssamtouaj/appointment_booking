import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/* Vercel reads its configuration from the project's Root Directory, which for this
   monorepo is `frontend/` — so this file sits beside package.json rather than at the
   repository root, where render.yaml lives for the opposite reason (Render only ever
   looks for a blueprint at the root of the repository).

   Not `new URL(..., import.meta.url)`: under the jsdom environment Vitest rewrites
   import.meta.url to an http: URL, and readFileSync rejects it. Vitest resolves cwd
   to the Vite config's root, which is the directory above this one. */
const VERCEL_JSON = join(process.cwd(), 'vercel.json')

interface Rewrite {
  source: string
  destination: string
}

function rewrites(): Rewrite[] {
  if (!existsSync(VERCEL_JSON)) return []
  const parsed = JSON.parse(readFileSync(VERCEL_JSON, 'utf8')) as { rewrites?: Rewrite[] }
  return parsed.rewrites ?? []
}

/** The first rewrite whose `source` matches, which is the one Vercel applies. */
function rewriteFor(pathname: string): Rewrite | undefined {
  return rewrites().find((rewrite) => new RegExp(`^${rewrite.source}$`).test(pathname))
}

/* One concrete URL per `path:` in routes.tsx, written as a browser would be pointed at
   it — a hard load or a refresh, where the CDN answers before React exists. Anything
   Vercel does not rewrite here is a 404 served off the filesystem. */
const DEEP_LINKS = [
  '/b/demo-salon',
  '/b/demo-salon/book',
  '/login',
  '/register',
  '/forgot-password',
  '/dashboard',
  '/calendar',
  '/team/8f14e45f-ceea-467a-9575-9c1e0a1b2c3d/hours',
  '/services',
  '/team',
  '/settings',
  '/a-path-that-matches-nothing',
]

/* Named by the backend and built into mail that has already been sent (F12). Every other
   route in this file could be renamed; these three cannot, and a 404 on one of them is a
   customer who cannot cancel and an invitation that cannot be accepted. */
const NAMED_IN_SENT_MAIL = [
  '/booking/2f1c8d4e-6b3a-4f27-9d51-7ac0e8b4f912',
  '/reset-password/T0kEn-with_symbols.and~dashes',
  '/accept-invitation/T0kEn-with_symbols.and~dashes',
]

describe('the Vercel rewrite that serves the SPA shell', () => {
  it('answers every client route with index.html rather than a filesystem 404', () => {
    for (const pathname of DEEP_LINKS) {
      const rewrite = rewriteFor(pathname)
      expect(rewrite, `no rewrite in vercel.json matches ${pathname}`).toBeDefined()
      expect(rewrite?.destination, `${pathname} is not sent to the SPA shell`).toBe('/index.html')
    }
  })

  it('covers the three paths the backend already put in sent mail', () => {
    for (const pathname of NAMED_IN_SENT_MAIL) {
      const rewrite = rewriteFor(pathname)
      expect(rewrite, `no rewrite in vercel.json matches ${pathname}`).toBeDefined()
      expect(rewrite?.destination, `${pathname} is not sent to the SPA shell`).toBe('/index.html')
    }
  })
})
