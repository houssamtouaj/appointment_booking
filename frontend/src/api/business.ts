import { client } from '@/api/client'
import { businessSchema, type Business, type BusinessRequest } from '@/api/schemas/business'

/**
 * `GET`/`PUT /api/business` — the tenant's own name, timezone, currency and
 * deposit rule.
 *
 * No id in either path, which is the whole reason the endpoints are safe: the
 * business under edit is the one in the access token, so "another tenant's
 * settings" is not a request that can be expressed. What is left is a role
 * question, and the `PUT` carries `@PreAuthorize("hasRole('OWNER')")` while the
 * `GET` does not — a staff member's calendar is drawn in the business timezone,
 * so hiding the numbers would leave them unable to explain their own screen.
 */

const BUSINESS_PATH = '/api/business'

/** Flat, like `policyKeys`. See `api/policy.ts` for why there is no tenant in it. */
export const businessKeys = {
  all: ['business'] as const,
}

export async function fetchBusiness(signal?: AbortSignal): Promise<Business> {
  const response = await client.get(BUSINESS_PATH, { signal })
  return businessSchema.parse(response.data)
}

/**
 * `PUT /api/business`.
 *
 * **Send the request the form built and nothing else.** In particular do not add
 * `confirmShift: true` here: a timezone change is answered `409
 * TIMEZONE_SHIFT_UNCONFIRMED` on the first attempt, and that refusal is the only
 * warning an owner gets before every future slot moves. Swallowing it in the
 * client — by pre-empting the flag, or by retrying automatically on the 409 —
 * removes the conversation the endpoint exists to have. `features/settings`
 * shows a dialog naming both zones and the number of affected bookings, and
 * resubmits only from its confirm button.
 *
 * The 409 arrives even when no bookings are affected. The bookings are the
 * visible consequence, not the reason.
 */
export async function updateBusiness(request: BusinessRequest): Promise<Business> {
  const response = await client.put(BUSINESS_PATH, request)
  return businessSchema.parse(response.data)
}
