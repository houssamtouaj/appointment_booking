import { createContext } from 'react'

import type { AuthResponse, MeResponse } from '@/types'

/**
 * The context object alone, in its own file.
 *
 * Not because the file is too long otherwise, but because `AuthProvider` is a
 * component and this is not: a module exporting both trips
 * `react-refresh/only-export-components`, and the cost of ignoring that rule is
 * that editing the provider does a full reload instead of a fast refresh.
 */

export type AuthStatus =
  /** The bootstrap refresh is in flight. Nothing protected may render yet. */
  'loading' | 'authenticated' | 'anonymous'

export type AuthContextValue = {
  status: AuthStatus
  /** Non-null exactly when `status === 'authenticated'`. */
  user: MeResponse | null
  /**
   * Adopt the session a login, register or demo-login just returned. Seeds the
   * `me` cache from `response.user` rather than firing a second request for
   * something the API already sent.
   */
  adoptSession: (auth: AuthResponse) => void
  /**
   * Revoke server-side, drop the token, and **empty the query cache**. The last
   * of those is not optional: leaving one tenant's dashboard in memory across a
   * sign-out is how the next login flashes the previous user's numbers before
   * its own arrive.
   */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
