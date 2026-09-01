import { useContext } from 'react'

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context'

/**
 * The session, from anywhere below `AuthProvider`.
 *
 * Throws rather than returning `null` when the provider is missing. A hook that
 * degrades quietly here would turn a mis-nested route into "the user appears
 * signed out", which is a bug that looks like a session bug and gets debugged in
 * the wrong file for an hour.
 *
 * It lives in `hooks/` for the same reason `use-lookups.ts` does, and the case is
 * stronger here: seven features read the session. `AuthContext` and
 * `AuthProvider` stay in `features/auth` because owning the session is that
 * feature's job — it is only the consumer-facing hook that needs a neutral home,
 * so that six features are not importing a seventh's internals.
 */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth was called outside AuthProvider')
  return value
}
