import { useState } from 'react'

import { client } from '@/api/client'
import { forgetAccessToken, getAccessToken } from '@/api/session'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/use-auth'

/**
 * Two buttons that exist so the single-flight refresh can be *seen* rather than
 * only asserted (exit demo step 4).
 *
 * The state it produces — a live session whose access token has expired — is the
 * ordinary state of this app fifteen minutes after signing in, and is otherwise
 * reachable only by waiting fifteen minutes. Without a way to reach it on
 * demand, the refresh path gets exercised by unit tests and by production, and
 * by nothing in between.
 *
 * `import.meta.env.DEV` is inlined as a literal `false` by Vite in a production
 * build, so the panel is not merely hidden there — the branch is constant and
 * the bundle keeps nothing that renders it.
 */
export function SessionDebugPanel() {
  const { status } = useAuth()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  if (!import.meta.env.DEV) return null
  if (status !== 'authenticated') return null

  return (
    <div className="fixed bottom-3 left-3 z-40 text-xs">
      {open ? (
        <div className="border-border bg-card w-72 rounded-sm border p-3 shadow-[var(--elevation-2)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-muted-foreground tracking-eyebrow font-mono uppercase">
              Session · dev only
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              close
            </button>
          </div>

          <p className="text-muted-foreground mb-3">
            Access token: {getAccessToken() ? 'in memory' : 'gone'}
          </p>

          <div className="grid gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                forgetAccessToken()
                setNote(
                  'Token dropped. The session is still established — exactly as it is when the token expires on its own.',
                )
              }}
            >
              Drop the access token
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setNote('Three requests in flight…')
                // Deliberately not through TanStack Query: three identical
                // queries would be deduplicated by the cache, which is the one
                // thing that must NOT happen here. The claim under test is that
                // three genuinely separate 401s produce one refresh, and the
                // dedupe would prove it for the wrong reason.
                const results = await Promise.allSettled([
                  client.get('/api/auth/me'),
                  client.get('/api/auth/me'),
                  client.get('/api/auth/me'),
                ])
                const ok = results.filter((result) => result.status === 'fulfilled').length
                setNote(
                  `${ok} of 3 succeeded. The network tab should show one refresh and three replays.`,
                )
              }}
            >
              Fire three requests at once
            </Button>
          </div>

          {note ? <p className="text-muted-foreground mt-3 leading-snug">{note}</p> : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="border-border bg-card text-muted-foreground hover:text-foreground rounded-sm border px-2 py-1 font-mono"
        >
          session
        </button>
      )}
    </div>
  )
}
