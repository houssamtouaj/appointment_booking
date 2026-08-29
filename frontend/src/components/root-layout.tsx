import { Link, Outlet } from 'react-router-dom'

import { Container } from '@/components/container'
import { ThemeToggle } from '@/components/theme-toggle'
import { Toaster } from '@/components/toaster'

/**
 * The shell every route renders inside. Wave 5 adds the authenticated admin nav
 * as a second layout nested under this one; the header here is the public chrome
 * and stays deliberately thin.
 */
export function RootLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Skip link: the first tab stop on every page. It is the difference between
          a keyboard user reaching the booking form in one key press and in
          fifteen, and it is why it is placed before the header rather than in it. */}
      <a
        href="#main"
        className="bg-primary text-primary-foreground sr-only rounded-sm px-4 py-2 text-sm font-medium focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50"
      >
        Skip to content
      </a>

      <header className="border-rule bg-background/85 sticky top-0 z-40 border-b backdrop-blur">
        <Container className="flex h-[var(--header-height)] items-center justify-between gap-4">
          <Link
            to="/"
            className="font-display text-foreground tracking-display text-xl leading-none"
          >
            Slotflow
          </Link>
          <ThemeToggle />
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

      <Toaster />
    </div>
  )
}
