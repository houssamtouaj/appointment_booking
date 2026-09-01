import { Link, Outlet } from 'react-router-dom'

import { Container } from '@/components/container'
import { ThemeToggle } from '@/components/theme-toggle'
import { SessionMenu } from '@/features/auth/session-menu'

/**
 * The chrome on everything a stranger can reach: the booking pages, the manage
 * page, and the four account screens.
 *
 * Deliberately thin, and deliberately *not* the admin shell. A customer picking
 * a slot has no use for a nav rail full of screens they cannot open, and the one
 * link that matters to a signed-in owner previewing their own booking page is
 * the way back in — which is what `SessionMenu` is.
 *
 * In `layouts/` for the same reason as `RootLayout`: it mounts a feature's
 * component, which is a thing a layout may do and a thing `components/` may not.
 */
export function PublicLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-rule bg-background/85 sticky top-0 z-40 border-b backdrop-blur">
        <Container className="flex h-[var(--header-height)] items-center justify-between gap-4">
          <Link
            to="/"
            className="font-display text-foreground tracking-display text-xl leading-none"
          >
            Slotflow
          </Link>
          <div className="flex items-center gap-2">
            <SessionMenu />
            <ThemeToggle />
          </div>
        </Container>
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-rule mt-16 border-t">
        <Container className="text-muted-foreground flex h-14 items-center text-xs">
          A booking platform. Times shown in the business&apos;s timezone.
        </Container>
      </footer>
    </div>
  )
}
