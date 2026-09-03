import { Link, useLocation } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { useSignOut } from '@/hooks/use-sign-out'
import { useTranslation } from '@/i18n'

/**
 * The right-hand end of the public header: who is signed in, and the way out.
 *
 * Wave 5's plan had the admin nav's account menu replacing this, and that is not
 * what happened — the two are on different headers and both are load-bearing.
 * `AccountMenu` needs an authenticated session to render a name, a monogram and
 * a link to the tenant's own booking page; this header is mounted on every
 * public route, most of which a stranger reaches, so it has to have an anonymous
 * state and a loading state as well. It is also the only thing that makes the
 * exit demo checkable — "sign in as demo, see the user's name" needs the name to
 * be somewhere.
 */
export function SessionMenu() {
  const { t } = useTranslation()
  const { status, user } = useAuth()
  const location = useLocation()
  const { leave, leaving } = useSignOut()

  // Nothing during the bootstrap. A "Log in" link that appears for one round
  // trip and then turns into a name is worse than a gap the same width.
  if (status === 'loading') return <span className="h-8 w-px" aria-hidden="true" />

  if (status === 'anonymous') {
    // Don't offer a link to the page you are on.
    if (location.pathname === '/login') return null
    return (
      <Button asChild variant="ghost" size="sm">
        <Link to="/login">{t('auth.session.logIn')}</Link>
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm sm:inline">
        <span className="text-foreground font-medium">{user?.fullName}</span>
        <span className="text-muted-foreground"> · {user?.business.name}</span>
      </span>
      <Button variant="ghost" size="sm" disabled={leaving} onClick={() => void leave()}>
        {leaving ? t('common.signingOut') : t('common.signOut')}
      </Button>
    </div>
  )
}
