import { Outlet } from 'react-router-dom'

import { SessionDebugPanel } from '@/features/auth/session-debug-panel'
import { Toaster } from '@/components/toaster'

/**
 * The frame every route renders inside, and nothing that looks like a page.
 *
 * Until wave 5 this component *was* the public chrome — header, footer, the
 * lot — which worked while every screen wanted the same header. The admin shell
 * does not: it wants a sidebar, a tenant header and no marketing footer, and
 * nesting it under the old root layout stacked two headers on every admin
 * screen. So the chrome moved down one level into `PublicLayout` and
 * `AdminLayout`, and what stays here is the three things that are true on all
 * nine screens.
 *
 * The skip link stays at this level because it has to be the **first tab stop on
 * the page**, before whichever header comes next. Both layouts below provide a
 * `<main id="main">` for it to land on.
 */
export function RootLayout() {
  return (
    <>
      {/* `fixed`, not `absolute`. Nothing in the ancestor chain is positioned, so
          `absolute` resolves against the initial containing block — 12px from the
          top of the DOCUMENT. Shift-tab back to the first stop after scrolling and
          the link takes focus, gets announced, and is nowhere on screen. */}
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only rounded-sm px-4 py-2 text-sm font-medium focus-visible:not-sr-only focus-visible:fixed focus-visible:top-3 focus-visible:left-3 focus-visible:z-50"
      >
        Skip to content
      </a>

      <Outlet />

      <Toaster />
      <SessionDebugPanel />
    </>
  )
}
