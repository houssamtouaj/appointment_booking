import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { authKeys, fetchMe, logout } from '@/api/auth'
import { startBootstrap } from '@/api/bootstrap'
import { onSessionEnded, signOutMessage } from '@/api/session'
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/features/auth/auth-context'
import type { AuthResponse, MeResponse } from '@/types'

/**
 * Session bootstrap and teardown, mounted once above the router.
 *
 * The rule that shapes everything below: **nothing protected renders until the
 * bootstrap has answered.** Without it the app opens with a burst of 401s that
 * all resolve correctly, look alarming in the network tab forever, and cost a
 * round trip each. The bootstrap promise itself lives in `@/api/bootstrap`, at
 * module scope, for the `StrictMode` reason set out there.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<MeResponse | null>(null)

  useEffect(() => {
    let active = true

    startBootstrap()
      .then((me) => {
        if (!active) return
        if (me) {
          queryClient.setQueryData(authKeys.me, me)
          setUser(me)
          setStatus('authenticated')
        } else {
          setStatus('anonymous')
        }
      })
      .catch(() => {
        // `bootstrapSession` swallows the anonymous case already; reaching here
        // means `me` itself failed on a session that had just been established.
        // Anonymous is the honest state, and still no toast: nobody asked for
        // anything yet.
        if (active) setStatus('anonymous')
      })

    return () => {
      active = false
    }
  }, [queryClient])

  useEffect(
    () =>
      onSessionEnded((reason) => {
        setUser(null)
        setStatus('anonymous')
        // `clear()`, not `invalidateQueries` — invalidation refetches, and every
        // one of those refetches would 401 against the session that just ended.
        queryClient.clear()
        // One toast. `onSessionEnded` fires once per ending regardless of how
        // many requests were in flight when it happened, which is the difference
        // between this and the six-toast version.
        toast.error(signOutMessage(reason))
      }),
    [queryClient],
  )

  const adoptSession = useCallback(
    (auth: AuthResponse) => {
      queryClient.setQueryData(authKeys.me, auth.user)
      setUser(auth.user)
      setStatus('authenticated')
    },
    [queryClient],
  )

  const refreshUser = useCallback(async () => {
    try {
      const me = await fetchMe()
      queryClient.setQueryData(authKeys.me, me)
      setUser(me)
    } catch {
      // Deliberately silent — see `refreshUser`'s contract in `auth-context.ts`.
      // The state that matters was already written by the request that
      // succeeded; this is a courtesy read, and a failed courtesy is not news.
    }
  }, [queryClient])

  const signOut = useCallback(async () => {
    try {
      await logout()
    } finally {
      setUser(null)
      setStatus('anonymous')
      queryClient.clear()
    }
  }, [queryClient])

  const value: AuthContextValue = { status, user, adoptSession, refreshUser, signOut }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
