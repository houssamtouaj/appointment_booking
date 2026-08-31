import { client } from '@/api/client'
import { policySchema, type Policy, type PolicyRequest } from '@/api/schemas/policy'

/**
 * `GET /api/policy` — read by the calendar for one number, and by wave 8's
 * settings screen for all four.
 *
 * It lives here rather than under a feature for the reason `useLookups()` does:
 * two screens want it, and putting it under either would make the other import
 * across a feature boundary, which is how the second copy gets written.
 */

const POLICY_PATH = '/api/policy'

/**
 * Flat, like `referenceKeys`. Every call is scoped to the tenant in the token
 * and there is no way to ask for another, so a business id in the key would be
 * decoration — and `AuthProvider` clears the whole cache on sign-out, which is
 * what actually keeps one tenant's settings out of the next session.
 */
export const policyKeys = {
  all: ['policy'] as const,
}

export async function fetchPolicy(signal?: AbortSignal): Promise<Policy> {
  const response = await client.get(POLICY_PATH, { signal })
  return policySchema.parse(response.data)
}

/**
 * `PUT /api/policy` — owner only, and a full replace of all four numbers.
 *
 * Nothing already booked moves. Changing the granularity can leave existing
 * appointments sitting off the new grid, which is correct and which the API
 * allows; a client-side warning implying the calendar is about to be rewritten
 * would be inventing a consequence that does not happen.
 */
export async function updatePolicy(request: PolicyRequest): Promise<Policy> {
  const response = await client.put(POLICY_PATH, request)
  return policySchema.parse(response.data)
}
