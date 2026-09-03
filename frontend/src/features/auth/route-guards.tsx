import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { toast } from 'sonner'

import { Container } from '@/components/container'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/use-auth'
import { translate, useTranslation } from '@/i18n'

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
 * **Redirect *and* say why, which is a change of behaviour from wave 2.** That
 * wave rendered an explanation in place and argued, correctly, that a silent
 * bounce is indistinguishable from a broken link — somebody following an old
 * bookmark would simply try it again tomorrow. Wave 5's gate then asked for the
 * opposite: typing `/settings` as a staff member must redirect rather than sit
 * on a page that only says no. Both are right about something, and a redirect
 * carrying a toast is the answer that keeps both: the URL resolves to a screen
 * with work on it, and nobody is left guessing what happened to the one they
 * asked for.
 *
 * `replace`, so the refused URL does not sit in history waiting for the back
 * button to walk into it a second time.
 */
export function RequireOwner() {
  const { user } = useAuth()

  // Fail closed. `RequireAuth` above means a null user here should be
  // unreachable, and "should be unreachable" is not a thing to render an
  // owner-only screen on the strength of: `user?.role !== 'OWNER'` refuses the
  // no-session case as well, so a future `setUser(null)` that does not land in
  // the same batch as its `setStatus` cannot flash `/settings` at somebody.
  const denied = user?.role !== 'OWNER'
  // ...but only a *staff* member has something to be told. There is no message
  // that is true when the session itself is gone.
  const explain = user !== null && denied

  // In an effect and not in the render body: a toast is a side effect on a store
  // outside React, and firing one during render is a state update in another
  // component's render phase. The redirect below unmounts this on the same tick,
  // and the effect still runs — cleanup ordering guarantees it.
  //
  // The `id` is what keeps it to **one** message. `StrictMode` mounts every
  // effect twice in development, so without it a staff member typing `/settings`
  // is told twice, in two stacked toasts — verified in the browser, not
  // theorised. A fixed id also collapses the honest repeat: three owner-only
  // URLs in a row is one sentence worth saying, not three.
  useEffect(() => {
    if (explain) {
      // `translate`, not the hook's `t`: `t` is a new function per language, so
      // it would have to join this effect's dependency list and a language
      // switch would re-fire the toast for a refusal that already happened.
      // The module store is read when the toast is written, which is the moment
      // that matters.
      toast.error(translate('auth.guards.ownerOnly'), {
        id: 'owner-only',
      })
    }
  }, [explain])

  if (denied) return <Navigate to="/dashboard" replace />

  return <Outlet />
}

/**
 * The bootstrap placeholder: the shape of an admin screen, not a spinner (F20).
 * It is on screen for one round trip on a cold load and for no time at all
 * afterwards.
 *
 * From wave 5 it renders *inside* the admin shell — `AdminLayout` sits above
 * this guard in the table — so the rail and the header are already there and
 * this only has to hold the geometry of the page body.
 */
function SessionPending() {
  const { t } = useTranslation()

  return (
    <Container className="py-8">
      {/* The live region a screen reader hears. The blocks below are aria-hidden. */}
      <span className="sr-only" role="status">
        {t('auth.guards.restoring')}
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
