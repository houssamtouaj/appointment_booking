import { client } from '@/api/client'
import {
  publicBusinessSchema,
  publicStaffListSchema,
  slotListSchema,
  type PublicBusiness,
  type PublicStaff,
  type Slot,
} from '@/api/schemas/public'
import { MAX_RANGE_DAYS, daysBetween, type DayRange } from '@/lib/time'

/**
 * The public half of the API: everything reachable without a session.
 *
 * These four endpoints go through the same Axios instance as everything else,
 * which is worth a sentence because none of them needs a token. Routing them
 * through `client` anyway is what gives them the problem-body mapping, the
 * `baseURL` and the cancellation behaviour — and the request interceptor
 * attaching a bearer token when a signed-in owner happens to be previewing their
 * own booking page is harmless: these controllers do not read it.
 */

const PUBLIC_PATH = '/api/public/businesses'

/**
 * Query keys, hierarchical so that a wave-4 booking can invalidate one
 * business's availability without touching another tenant's cache.
 *
 * `availability` takes the whole request rather than a spread of arguments: the
 * key and the request are the same tuple, and letting them drift is how a
 * prefetched week lands under the key of the week that is showing.
 */
export const publicKeys = {
  all: ['public'] as const,
  business: (slug: string) => ['public', slug] as const,
  staff: (slug: string, serviceId: string) => ['public', slug, 'staff', serviceId] as const,
  availability: (slug: string, request: AvailabilityRequest) =>
    ['public', slug, 'availability', request] as const,
}

/**
 * The landing page's one call. Business, opening hours and the active catalogue
 * in a single round trip.
 *
 * A 404 here is a designed screen rather than a failure to log: this URL is
 * pasted into messages, and a mistyped slug has to say so.
 */
export async function fetchBusiness(slug: string, signal?: AbortSignal): Promise<PublicBusiness> {
  const response = await client.get(`${PUBLIC_PATH}/${encodeURIComponent(slug)}`, { signal })
  return publicBusinessSchema.parse(response.data)
}

/** Who performs this service. `{ id, displayName }` only — see the schema. */
export async function fetchStaff(
  slug: string,
  serviceId: string,
  signal?: AbortSignal,
): Promise<PublicStaff[]> {
  const response = await client.get(`${PUBLIC_PATH}/${encodeURIComponent(slug)}/staff`, {
    params: { serviceId },
    signal,
  })
  return publicStaffListSchema.parse(response.data)
}

export type AvailabilityRequest = DayRange & {
  serviceId: string
  /**
   * The **business's** zone, always (F8). Sending the viewer's would ask the
   * server to frame days in Casablanca for a salon in Paris, and the day a slot
   * lands under here would stop agreeing with the day it is rendered under.
   */
  tz: string
  /**
   * Omitted entirely when the customer chose "anyone" — `undefined`, never a
   * staff id picked from a slot's `staffIds`. That is the difference between
   * letting the server balance the booking and choosing on its behalf.
   */
  staffId?: string
}

/**
 * One availability search.
 *
 * The range check is client-side and deliberate. The API caps the range at 62
 * days **inclusive of both ends**, so `from + 62` is 63 days and a 422 — the
 * off-by-one that the "find the next opening" search would otherwise walk
 * straight into. Failing here names the bug; failing at the server names a
 * field.
 */
export async function fetchAvailability(
  slug: string,
  request: AvailabilityRequest,
  signal?: AbortSignal,
): Promise<Slot[]> {
  const span = daysBetween(request.from, request.to) + 1
  if (span > MAX_RANGE_DAYS) {
    throw new RangeError(
      `Availability range is ${span} days; the API accepts at most ${MAX_RANGE_DAYS} inclusive of both ends.`,
    )
  }

  const response = await client.get(`${PUBLIC_PATH}/${encodeURIComponent(slug)}/availability`, {
    // Axios drops `undefined` params, which is what keeps "anyone" from
    // becoming `staffId=undefined` on the query string.
    params: {
      serviceId: request.serviceId,
      from: request.from,
      to: request.to,
      tz: request.tz,
      staffId: request.staffId,
    },
    signal,
  })
  return slotListSchema.parse(response.data)
}
