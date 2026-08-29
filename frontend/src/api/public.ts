import { client } from '@/api/client'
import { publicBookingSchema, type BookingRequest, type PublicBooking } from '@/api/schemas/booking'
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
  /**
   * Every week of one business's availability, without naming a request.
   *
   * This is the key a booking invalidates. After a `201` — or a `409` that says
   * somebody else got there first — every cached week is stale, not just the one
   * on screen: the engine's buffers mean a 10:00 booking can remove the 09:35
   * and the 10:35 too, and those may sit in a prefetched neighbouring week.
   */
  availabilityAll: (slug: string) => ['public', slug, 'availability'] as const,
  availability: (slug: string, request: AvailabilityRequest) =>
    ['public', slug, 'availability', request] as const,
  /**
   * A booking, keyed by the token rather than by its id and outside the
   * per-business tree — the manage page is reached from an email and knows no
   * slug at all.
   */
  booking: (cancellationToken: string) => ['public', 'booking', cancellationToken] as const,
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

// ---------------------------------------------------------------------------
//  The booking itself, and the manage page behind its token
// ---------------------------------------------------------------------------

/**
 * `POST .../bookings` — the one write on this whole surface.
 *
 * The response is authoritative about what happened next (F5): a `CONFIRMED`
 * with no `checkoutUrl` is a finished booking, a `PENDING` with one is a hold
 * awaiting a deposit. Nothing read before this call — least of all the landing
 * page's `depositRequired` — may decide that, because the client cannot see
 * `payments.enabled()` and the server ANDs the two.
 *
 * Deliberately **not** given a retry, here or in the mutation defaults: a
 * booking is a side effect, and a retried `POST` after a timeout that actually
 * succeeded is a double booking created out of a network blip.
 */
export async function createBooking(
  slug: string,
  request: BookingRequest,
  signal?: AbortSignal,
): Promise<PublicBooking> {
  const response = await client.post(
    `${PUBLIC_PATH}/${encodeURIComponent(slug)}/bookings`,
    request,
    { signal },
  )
  return publicBookingSchema.parse(response.data)
}

const BOOKINGS_PATH = '/api/public/bookings'

/**
 * `GET /api/public/bookings/{cancellationToken}` — everything behind the manage
 * link.
 *
 * The token is the whole credential (backend D1) and it is in the path rather
 * than a header because that is where the backend put it; there is no account to
 * sign in to and nothing else to present. A token that resolves to nothing is a
 * `404` exactly like one that never existed, which the page renders as a
 * designed screen rather than a failure to log.
 */
export async function fetchBooking(
  cancellationToken: string,
  signal?: AbortSignal,
): Promise<PublicBooking> {
  const response = await client.get(`${BOOKINGS_PATH}/${encodeURIComponent(cancellationToken)}`, {
    signal,
  })
  return publicBookingSchema.parse(response.data)
}

/**
 * `DELETE` — and it answers `200` with the cancelled booking rather than `204`.
 *
 * That is deliberate on the backend's side and load-bearing on this one: the
 * body carries `depositRefundable: false`, and a customer who has just given up
 * a deposit is owed that in the response to the request that did it. So the
 * result is parsed and rendered, not discarded.
 */
export async function cancelBooking(
  cancellationToken: string,
  signal?: AbortSignal,
): Promise<PublicBooking> {
  const response = await client.delete(
    `${BOOKINGS_PATH}/${encodeURIComponent(cancellationToken)}`,
    { signal },
  )
  return publicBookingSchema.parse(response.data)
}
