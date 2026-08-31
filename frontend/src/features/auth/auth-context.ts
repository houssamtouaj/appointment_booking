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
   * Re-read `GET /api/auth/me` and adopt the answer.
   *
   * Exactly one screen needs this, and it is why it exists rather than a
   * general-purpose refresh: `MeResponse.business` carries the tenant's name,
   * timezone and currency, and the settings form is the one place they change.
   * Those three are not query state — they are held here, seeded once by the
   * bootstrap — so `invalidateQueries` cannot reach them, and without this the
   * admin shell keeps the old business name and, worse, every screen keeps
   * drawing in the old timezone until a reload.
   *
   * Swallows its own failure. The save has already succeeded by the time this
   * runs; a second toast about a follow-up read would report a problem the
   * person cannot act on and did not cause.
   */
  refreshUser: () => Promise<void>
  /**
   * Revoke server-side, drop the token, and **empty the query cache**. The last
   * of those is not optional: leaving one tenant's dashboard in memory across a
   * sign-out is how the next login flashes the previous user's numbers before
   * its own arrive.
   */
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
