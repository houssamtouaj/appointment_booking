import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'

import { Container } from '@/components/container'
import { ErrorState } from '@/components/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/features/auth/use-auth'

/**
 * The two route guards (F19). Layout routes, so they wrap a whole branch of the
 * table rather than being remembered per screen.
 */

/**
 * Waits for the bootstrap, then admits or redirects.
 *
 * The wait is the important half. Rendering the children optimistically and
 * redirecting on the first 401 would work, and would also mean every protected
 * screen fires its queries against a session that does not exist yet — the burst
 * of 401s the wave's watch-outs name specifically.
 */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') return <SessionPending />

  if (status === 'anonymous') {
    // Where they were going, so the login screen can finish the journey rather
    // than dropping everyone on the dashboard. `search` is kept: a link into a
    // filtered calendar is worth as much as the path.
    const next = `${location.pathname}${location.search}`
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  }

  return <Outlet />
}

/**
 * Owner-only routes. Nested inside `RequireAuth`, so by the time this renders
 * the session is known and the only question left is the role.
 *
 * A staff member who follows a bookmarked owner URL gets told what happened,
 * not bounced to the dashboard: a silent redirect is indistinguishable from a
 * broken link, and they would try it again tomorrow.
 */
export function RequireOwner() {
  const { user } = useAuth()

  if (user?.role !== 'OWNER') {
    return (
      <Container className="py-16">
        <ErrorState
          title="This page is for owners"
          description="Your account has staff access, which covers your own calendar and working hours. Ask an owner of this business if you need more."
        />
        <p className="mt-6 text-center text-sm">
          <Link to="/dashboard" className="text-primary underline underline-offset-4">
            Back to the dashboard
          </Link>
        </p>
      </Container>
    )
  }

  return <Outlet />
}

/**
 * The bootstrap placeholder: the shape of the admin shell, not a spinner (F20).
 * It is on screen for one round trip on a cold load and for no time at all
 * afterwards, and it holds the geometry so the page does not jump when the real
 * header arrives.
 */
function SessionPending() {
  return (
    <Container className="py-8">
      {/* The live region a screen reader hears. The blocks below are aria-hidden. */}
      <span className="sr-only" role="status">
        Restoring your session
      </span>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-3 h-9 w-64" />
      <Skeleton className="mt-6 h-px w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    </Container>
  )
}
