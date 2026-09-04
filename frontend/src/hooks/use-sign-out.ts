import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'

import { useAuth } from '@/hooks/use-auth'
import { translate } from '@/i18n'

export type SignOutControl = {
  /** Revoke, confirm, and land on the login screen. Never rejects. */
  leave: () => Promise<void>
  /** True while the round trip is in flight. Disables the control that started it. */
  leaving: boolean
}

/**
 * Leaving, in one place.
 *
 * The four steps were written out twice, identically — the public header's
 * `SessionMenu` and the admin shell's `AccountMenu` — and they are four steps
 * rather than one for reasons that are easy to lose on a second copy. The flag
 * is what stops a double-click sending two revocations. The toast is the
 * confirmation the person asked for something and got it, and it has to fire
 * *before* the navigation so it is not a message about a screen they have left.
 * The `replace` keeps the screen they just left off the back stack, which
 * matters because that screen is behind a guard and would bounce them forward
 * again.
 *
 * `AuthProvider.signOut` swallows its own network failure — a revocation that
 * did not reach the server still has to end the session locally — so there is no
 * failure branch here. The `finally` exists for the unmount case rather than the
 * error case: the admin menu closes on select and takes the handler's owner with
 * it.
 *
 * In `hooks/` because both consumers are in different features, which is the
 * same argument `use-auth.ts` and `use-lookups.ts` make about themselves.
 */
export function useSignOut(): SignOutControl {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [leaving, setLeaving] = useState(false)

  const leave = useCallback(async () => {
    setLeaving(true)
    try {
      await signOut()
      toast.success(translate('auth.session.signedOut'))
      navigate('/login', { replace: true })
    } finally {
      setLeaving(false)
    }
  }, [navigate, signOut])

  return { leave, leaving }
}
