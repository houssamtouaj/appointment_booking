import { bootstrapSession, fetchMe } from '@/api/auth'
import type { MeResponse } from '@/types'

/**
 * Restoring a session on a cold page load: one refresh, then one `me`.
 *
 * At module scope rather than inside `AuthProvider`, and that is the whole
 * reason this file is separate from it. `StrictMode` mounts every effect twice
 * in development, so a `useRef` guard is recreated by the remount and does not
 * stop the second call — the network tab then shows two refreshes where the wave
 * gate asks for exactly one. A module-level promise is the thing whose lifetime
 * actually matches "once per page load".
 *
 * A second, sequential refresh would in fact be harmless: rotation is normal,
 * and `refreshSession` is single-flight so a *concurrent* one joins rather than
 * racing. This is about the demo being legible, not about correctness.
 */
let bootstrap: Promise<MeResponse | null> | null = null

export function startBootstrap(): Promise<MeResponse | null> {
  bootstrap ??= (async () => {
    const auth = await bootstrapSession()
    if (!auth) return null
    // The refresh response carries `user` as well, so this is a round trip that
    // could be skipped — and is not, because `me` is the canonical answer and a
    // reload is exactly when a tenant renamed in another tab should come back
    // correct.
    return fetchMe()
  })()
  return bootstrap
}

/** Test seam: lets each case start from a cold page. Nothing in the app calls it. */
export function resetBootstrap(): void {
  bootstrap = null
}
