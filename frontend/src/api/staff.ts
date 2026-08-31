import { client } from '@/api/client'
import {
  staffSchema,
  staffUpdateResponseSchema,
  type InviteStaffRequest,
  type Staff,
  type StaffUpdateResponse,
  type UpdateStaffRequest,
} from '@/api/schemas/staff'

/**
 * `/api/staff` — the three writes screen 8 makes.
 *
 * **The read is not here.** `GET /api/staff` is already fetched by
 * `api/reference.ts` as `fetchTeam`, under `referenceKeys.staff`, and it is
 * exactly the list this screen wants: a plain array, unpaged, deactivated people
 * included. So the team screen mounts the same query rather than a second one —
 * one request serves the calendar's name lookups and the roster, and every
 * mutation below invalidates that single entry.
 *
 * That is not a tidiness argument. `GET /api/services` is paginated and
 * `GET /api/staff` is not, so the two halves of this wave read differently on
 * purpose: the catalogue screen has its own paged cache and the team screen has
 * none, because there is no page to be on.
 */

/** The same string `api/reference.ts` reads the team from. */
export const STAFF_PATH = '/api/staff'

/**
 * `POST /api/staff/invite` → `201` with the new, inactive colleague.
 *
 * What happens next is worth stating where the call is, because the screen has
 * to say it in words: the API creates a user with no password, generates a
 * single-use token that lasts seven days, and emails a link built from
 * `FRONTEND_BASE_URL` to `/accept-invitation/{token}`. Nothing is sent back
 * about the token — correctly; it is a credential — so the only way to follow it
 * locally is the mail itself, which Compose delivers to MailHog.
 *
 * `409 EMAIL_TAKEN` means that address already has an account **somewhere in the
 * product**, not just in this business: one human cannot own two businesses in
 * v1 (backend D13). The screen says that rather than "conflict".
 */
export async function inviteStaff(request: InviteStaffRequest): Promise<Staff> {
  const response = await client.post(`${STAFF_PATH}/invite`, request)
  return staffSchema.parse(response.data)
}

/**
 * `POST /api/staff/{id}/invite/resend` → `200` with the colleague.
 *
 * It invalidates every outstanding link before issuing the new one
 * (`StaffAdminService.issueInvitation` marks them used), so an invitation that
 * has been resent cannot accumulate live keys to the account. The demo relies on
 * that: the *first* mail's link stops working the moment the second is sent.
 *
 * Two `409 DATA_CONFLICT` refusals, and their prose is the server's because it
 * is already the right prose: resending to somebody who has accepted, and
 * resending to somebody who accepted once and was then deactivated — that second
 * person needs *Reactivate*, and the message says so.
 */
export async function resendInvitation(id: string): Promise<Staff> {
  const response = await client.post(`${STAFF_PATH}/${encodeURIComponent(id)}/invite/resend`, {})
  return staffSchema.parse(response.data)
}

/**
 * `PATCH /api/staff/{id}` → `{ staff, warning? }`, and the envelope is the point.
 *
 * This is the only endpoint in the API that answers a successful write with a
 * *consequence* attached. `warning` arrives when the change deactivated somebody
 * who still has appointments ahead of them, and it carries the count and the
 * next one's instant — which is the difference between "done" and "done, and
 * here is what you have just done". Screen 8 renders it as a persistent alert
 * with an undo, deliberately not as a toast that vanishes in four seconds.
 *
 * `409 LAST_OWNER` when the change would leave the business with no active
 * owner, from either direction: deactivating the only one, or demoting them to
 * `STAFF`.
 */
export async function updateStaff(
  id: string,
  request: UpdateStaffRequest,
): Promise<StaffUpdateResponse> {
  const response = await client.patch(`${STAFF_PATH}/${encodeURIComponent(id)}`, request)
  return staffUpdateResponseSchema.parse(response.data)
}
