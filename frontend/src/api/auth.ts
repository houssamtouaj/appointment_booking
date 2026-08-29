import { AUTH_PATH, client, refreshSession } from '@/api/client'
import {
  authResponseSchema,
  meResponseSchema,
  type AuthResponse,
  type ForgotPasswordRequest,
  type LoginRequest,
  type MeResponse,
  type RegisterRequest,
  type ResetPasswordRequest,
} from '@/api/schemas/auth'
import {
  invitationPreviewSchema,
  type AcceptInvitationRequest,
  type InvitationPreview,
} from '@/api/schemas/invitation'
import { beginSession, endSessionQuietly } from '@/api/session'

/**
 * The `/api/auth` endpoints and the two public invitation ones, as functions.
 *
 * Every response is `.parse`d rather than cast. A cast is a promise about a
 * network payload that nothing checks; parsing turns a backend that changed
 * shape into a loud failure at the boundary instead of `undefined.business.name`
 * three components deep. These bodies are small and the cost is nil.
 *
 * The three that establish a session call `beginSession` here rather than in the
 * caller, so there is no path that gets a token and forgets to store it.
 */

/** TanStack Query keys for anything auth-shaped. `me` is seeded, never fetched twice. */
export const authKeys = {
  me: ['auth', 'me'] as const,
  invitation: (token: string) => ['auth', 'invitation', token] as const,
}

export async function login(request: LoginRequest): Promise<AuthResponse> {
  return establish(await client.post(`${AUTH_PATH}/login`, request))
}

/**
 * The **Log in as demo admin** button (F16, and the brief asks for it by name).
 *
 * No body and no credentials — that is the endpoint's entire reason for
 * existing. The demo password is in the README either way, but a bundle that
 * ships one teaches every reader of the source the wrong lesson. Present only
 * when the API runs the `demo` profile; a 404 here means it does not.
 */
export async function demoLogin(): Promise<AuthResponse> {
  return establish(await client.post(`${AUTH_PATH}/demo-login`))
}

export async function register(request: RegisterRequest): Promise<AuthResponse> {
  return establish(await client.post(`${AUTH_PATH}/register`, request))
}

/**
 * One `POST /api/auth/refresh`, then the user. Returns `null` for an anonymous
 * visitor rather than throwing — a first-time visitor is not an error, and the
 * wave gate says so: no toast on a cold open.
 *
 * The `user` comes back inside the refresh response, so this is one round trip
 * and not two; `AuthProvider` seeds the `me` cache from it.
 */
export async function bootstrapSession(): Promise<AuthResponse | null> {
  try {
    return await refreshSession()
  } catch {
    // The interceptor has already ended the session and, because none was
    // established, told nobody. Swallowing the error is the whole behaviour.
    return null
  }
}

export async function fetchMe(): Promise<MeResponse> {
  const response = await client.get(`${AUTH_PATH}/me`)
  return meResponseSchema.parse(response.data)
}

/**
 * Revokes the refresh token server-side and clears the cookie.
 *
 * Tolerant of failure on purpose: the local session is being thrown away
 * regardless, and an offline user who cannot reach the API must still end up
 * signed out on this device rather than stuck. The server-side revocation is
 * what is lost, and that token expires on its own.
 */
export async function logout(): Promise<void> {
  try {
    await client.post(`${AUTH_PATH}/logout`)
  } catch {
    // This `catch` is the tolerance the paragraph above promises. A bare
    // `finally` runs the cleanup and then re-throws, which is not the same
    // thing: the rejection travels through `AuthProvider.signOut` into the
    // sign-out button's `onClick`, where nothing awaits it — an unhandled
    // rejection, no "Signed out" toast and no redirect, leaving an offline user
    // on a page that has already forgotten who they are.
  } finally {
    endSessionQuietly()
  }
}

/** Always resolves on a 202 — the API answers the same whether or not the address exists (D6). */
export async function forgotPassword(request: ForgotPasswordRequest): Promise<void> {
  await client.post(`${AUTH_PATH}/forgot-password`, request)
}

/**
 * Consumes the emailed token. The API revokes every refresh token the user holds
 * and clears the cookie, so the caller is anonymous afterwards by design — a
 * reset exists to end sessions somebody else may have created.
 */
export async function resetPassword(request: ResetPasswordRequest): Promise<void> {
  await client.post(`${AUTH_PATH}/reset-password`, request)
  endSessionQuietly()
}

/** `410 INVITATION_CONSUMED` for a used or expired token, `404` for one that never existed. */
export async function fetchInvitation(token: string): Promise<InvitationPreview> {
  const response = await client.get(`/api/public/invitations/${encodeURIComponent(token)}`)
  return invitationPreviewSchema.parse(response.data)
}

/** 204, and no session: the invitee signs in afterwards like anybody else. */
export async function acceptInvitation(
  token: string,
  request: AcceptInvitationRequest,
): Promise<void> {
  await client.post(`/api/public/invitations/${encodeURIComponent(token)}/accept`, request)
}

function establish(response: { data: unknown }): AuthResponse {
  const auth = authResponseSchema.parse(response.data)
  beginSession(auth.accessToken)
  return auth
}
