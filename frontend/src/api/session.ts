/**
 * Where the access token lives: a module-level variable, and nowhere else (F1).
 *
 * Not `localStorage`, not `sessionStorage`, not a non-httpOnly cookie. The whole
 * argument for the backend's cookie design (`RefreshTokenCookie`) is that an XSS
 * bug cannot exfiltrate a seven-day credential; putting the fifteen-minute one
 * in storage gives back most of what that bought, because storage survives the
 * tab and is readable by any script on the origin. A closure variable dies with
 * the page, which is exactly the lifetime an access token should have — and the
 * refresh cookie is what makes losing it on reload cost one round trip instead
 * of a login.
 *
 * The wave gate asserts this: a `document.cookie` or `localStorage` dump after
 * signing in must not contain the token.
 */

/** Why a session ended without the user asking. */
export type SessionEndReason =
  /** The refresh cookie was missing, expired or rejected. Ordinary. */
  | 'expired'
  /**
   * `401 REFRESH_REUSED`. The backend saw an already-rotated token and revoked
   * the whole chain, which it treats as theft. This is not a generic 401 and
   * must not get the generic 401 copy — see `signOutMessage`.
   */
  | 'reused'

type Listener = (reason: SessionEndReason) => void

let accessToken: string | null = null
/**
 * Whether a session was ever established, tracked separately from the token
 * because the two answer different questions. The token is gone the moment it
 * expires; this stays true until the session actually ends.
 *
 * It is what keeps a first-time visitor silent. The bootstrap refresh 401s for
 * anonymous and signed-in-but-expired alike, and only one of those is an event
 * worth a message.
 */
let established = false

const listeners = new Set<Listener>()

export function getAccessToken(): string | null {
  return accessToken
}

/** True once a session exists, until it ends. Unaffected by the token expiring. */
export function hasSession(): boolean {
  return established
}

/**
 * A successful login, register, demo-login, bootstrap **or rotation**.
 *
 * There was a second, narrower `setAccessToken` here — token only, `established`
 * untouched — on the argument that a rotation cannot establish what already
 * exists. Nothing called it, and nothing should: the rotation path is
 * `refreshSession`, which is also the *bootstrap* path (`bootstrapSession`
 * wraps it), and on a cold page load that call is precisely what establishes the
 * session. A narrower function there would leave a reloaded tab holding a valid
 * token with `established` false, so the next involuntary ending would tell
 * nobody.
 */
export function beginSession(token: string): void {
  accessToken = token
  established = true
}

/**
 * The user asked to leave. No listener fires: the code that called `logout` is
 * already going to say something, and a second message about being signed out
 * is the toast nobody wants.
 */
export function endSessionQuietly(): void {
  accessToken = null
  established = false
}

/**
 * The session ended and nobody asked for it.
 *
 * Fires listeners **only if a session actually existed**. That guard is the
 * difference between an app that opens quietly for a stranger and one that
 * greets them with "your session expired" (a wave gate, and the kind of detail
 * that reads as broken rather than as careful).
 */
export function endSession(reason: SessionEndReason): void {
  const wasEstablished = established
  accessToken = null
  established = false
  if (!wasEstablished) return
  for (const listener of listeners) listener(reason)
}

/** Subscribe to involuntary endings. Returns the unsubscribe, for `useEffect`. */
export function onSessionEnded(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Throws the access token away while leaving the session established — which is
 * exactly the state the app is in fifteen minutes after signing in, and
 * otherwise impossible to reach on demand.
 *
 * Exit demo step 4 needs it: fire three queries from here and the network tab
 * must show one refresh and three replays. Reached from the dev-only control in
 * `SessionDebugPanel`, which renders under `import.meta.env.DEV` only.
 */
export function forgetAccessToken(): void {
  accessToken = null
}

/** The one sentence each ending gets. `reused` is its own, deliberately (wave gate). */
export function signOutMessage(reason: SessionEndReason): string {
  return reason === 'reused'
    ? 'You were signed out because your session was used from somewhere else.'
    : 'Your session expired. Please sign in again.'
}
