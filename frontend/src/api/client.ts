import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { ApiError, toApiError } from '@/api/error'
import { authResponseSchema, type AuthResponse } from '@/api/schemas/auth'
import { beginSession, endSession, getAccessToken } from '@/api/session'
import { API_ORIGIN } from '@/lib/env'

/**
 * The one Axios instance (F1, F2). Every request in the app goes through it, so
 * that "attach the token", "rotate on 401" and "turn a problem body into an
 * `ApiError`" are each written once.
 *
 * The refresh interceptor below is about thirty lines and five of them are
 * subtle. Each of the five has a test in `client.test.ts`, named after the
 * failure it prevents rather than after the code it covers.
 */

/** The cookie's scope, and therefore the path that must never be rewritten. */
export const AUTH_PATH = '/api/auth'
export const REFRESH_PATH = `${AUTH_PATH}/refresh`

/**
 * The paths that present a credential instead of the access token, and whose
 * 401 therefore means "refused", not "expired" (rule 3 below).
 *
 * `/demo-login` belongs here for a reason worth writing down: `SecurityConfig`
 * deliberately keeps it out of the public allowlist, so a deployment running
 * without the `demo` profile refuses it from the filter chain with a 401 rather
 * than a 404 from the absent controller. `DemoLoginDisabledIT` pins exactly
 * that, and it is why the path cannot be left to rule 5.
 */
const CREDENTIAL_PATHS = [`${AUTH_PATH}/login`, `${AUTH_PATH}/demo-login`]

/**
 * Marks a config that has already been replayed once. A plain property rather
 * than a `Symbol`: Axios's `mergeConfig` copies unknown keys onto the config it
 * builds for the replay, which is what lets rule 3 recognise a second failure of
 * the same request.
 */
type RetryableConfig = InternalAxiosRequestConfig & { slotflowRetried?: boolean }

export const client = axios.create({
  baseURL: API_ORIGIN,
  // Always, in every mode, and not negotiable: the refresh cookie is not sent
  // without it. CORS on this API already answers with
  // `Access-Control-Allow-Credentials`, and refuses to start with a wildcard
  // origin — so if a preflight fails locally, `CORS_ALLOWED_ORIGINS` is the
  // thing to check before anything in this file.
  withCredentials: true,
  headers: { Accept: 'application/json' },
})

// ---------------------------------------------------------------------------
//  Request: attach the in-memory token, and nothing when there is none
// ---------------------------------------------------------------------------

client.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) {
    // Sent on `/refresh` and `/logout` too, which take the cookie as their
    // credential and ignore this header. That is safe rather than sloppy:
    // `JwtAuthenticationFilter` parses the token, gets null for an expired one
    // and simply continues the chain — an invalid bearer token is never itself
    // a rejection. Special-casing the two paths would be a branch that buys
    // nothing.
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

// ---------------------------------------------------------------------------
//  The single in-flight refresh
// ---------------------------------------------------------------------------

/**
 * One promise, shared by every 401 that arrives while it is pending.
 *
 * This is the whole reason the wave exists. Without it: a dashboard mounts, six
 * queries fire, all six 401 on an expired token, and six refresh calls race. The
 * backend rotates on every call and treats a re-presented token as theft, so one
 * wins and the other five come back `401 REFRESH_REUSED` — which revokes the
 * entire chain and signs the user out at the precise moment the code was trying
 * to keep them in. It is not a race that shows up on a fast laptop with two
 * queries; it shows up in production on the screen with the most going on.
 *
 * Cleared in `finally`, so a failed refresh does not wedge every later 401 onto
 * a permanently rejected promise.
 */
let inFlightRefresh: Promise<AuthResponse> | null = null

/**
 * Rotate the refresh cookie and take the new access token.
 *
 * Deliberately routed through `client` rather than a bare Axios call. A separate
 * instance would make rule 2 below unnecessary — and would also mean the one
 * request whose failure ends the session is the one request that does not get
 * `baseURL`, `withCredentials` or the problem-body mapping. The recursion guard
 * is cheaper than that divergence, and it is tested.
 */
export function refreshSession(): Promise<AuthResponse> {
  inFlightRefresh ??= client
    .post(REFRESH_PATH)
    .then((response) => {
      const auth = authResponseSchema.parse(response.data)
      beginSession(auth.accessToken)
      return auth
    })
    .finally(() => {
      inFlightRefresh = null
    })
  return inFlightRefresh
}

/** Test seam. Nothing in the app calls this; `client.test.ts` does, between cases. */
export function resetInFlightRefresh(): void {
  inFlightRefresh = null
}

// ---------------------------------------------------------------------------
//  Response: problem bodies out, one rotation and one replay on 401
// ---------------------------------------------------------------------------

client.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    // A cancelled request is not a failure — TanStack Query aborts in-flight
    // queries on unmount as a matter of routine. Converting it to an `ApiError`
    // would put a toast on every fast navigation.
    if (axios.isCancel(error)) throw error

    const apiError = toApiError(error)
    const config = (error as AxiosError).config as RetryableConfig | undefined

    // 1. Anything that is not a 401 is already in its final shape.
    if (apiError.status !== 401 || !config) throw apiError

    // 2. The 401 came from `/refresh` itself. Refreshing again would call
    //    `/refresh` again, whose 401 would call it again: the recursion this
    //    guard exists for, and the reason a bare-Axios refresh is a tempting
    //    wrong answer. `REFRESH_REUSED` gets its own reason because it means
    //    something different — the chain was revoked, not merely expired.
    if (isRefreshRequest(config)) {
      endSession(apiError.code === 'REFRESH_REUSED' ? 'reused' : 'expired')
      throw apiError
    }

    // 3. The 401 came from a request carrying a credential rather than the
    //    access token, so it means "wrong password", not "expired token" — and
    //    rotating here is the wrong reflex twice over. Every mistyped password
    //    would spend a refresh, charged to the shared `PUBLIC_WRITE` rate-limit
    //    bucket that `RateLimitFilter` puts `/refresh` in (login has its own
    //    `LOGIN` scope, so the budget the typo drains is somebody else's public
    //    booking write), and would then replay the credentials. Worse: a
    //    visitor who still holds a live refresh cookie while this tab thinks it
    //    is anonymous would have that session rotated, consumed, and finally
    //    ended by rule 4 — a failed sign-in signing out the session it failed
    //    next to. Nothing is ended here on purpose.
    if (isCredentialRequest(config)) throw apiError

    // 4. Already replayed once with a token that had just been minted, and the
    //    answer is still 401. A second rotation cannot help — whatever is wrong
    //    is not the token's age — and retrying forever is how a dead session
    //    becomes an infinite request loop.
    if (config.slotflowRetried) {
      endSession('expired')
      throw apiError
    }

    // 5. Join the rotation already in progress, or start the only one.
    config.slotflowRetried = true
    let auth: AuthResponse
    try {
      auth = await refreshSession()
    } catch (refreshError) {
      // Rule 2 has already ended the session on the refresh request's own
      // rejection, so there is nothing to clean up here. What matters is which
      // error the caller sees: the ORIGINAL one, because the screen decides what
      // to say from its `code` and "your booking could not be loaded" is not the
      // same message as "refresh failed". The refresh failure is kept as `cause`
      // rather than dropped.
      throw withCause(apiError, refreshError)
    }

    config.headers.set('Authorization', `Bearer ${auth.accessToken}`)
    return client.request(config)
  },
)

function isRefreshRequest(config: InternalAxiosRequestConfig): boolean {
  return matchesPath(config, REFRESH_PATH)
}

function isCredentialRequest(config: InternalAxiosRequestConfig): boolean {
  return CREDENTIAL_PATHS.some((path) => matchesPath(config, path))
}

function matchesPath(config: InternalAxiosRequestConfig, path: string): boolean {
  const url = config.url ?? ''
  // `endsWith` rather than equality: the URL is whatever the call site passed,
  // and an absolute one is legal.
  return url === path || url.endsWith(path)
}

/**
 * The original error, re-made with the refresh failure as its `cause`.
 *
 * A copy rather than a mutation because `ApiError`'s fields are `readonly` and
 * `Error.cause` is fixed at construction. Same class, same `code`, same
 * `status`, so a call site checking `isApiError(e, 'NOT_FOUND')` cannot tell the
 * difference — which is the point. Only a debugger, or whoever reads the console
 * later, gains anything.
 */
function withCause(original: ApiError, cause: unknown): ApiError {
  return new ApiError({
    code: original.code,
    status: original.status,
    detail: original.detail,
    errors: original.errors,
    requestId: original.requestId,
    problem: original.problem,
    cause,
  })
}
