import { client } from '@/api/client'
import {
  bookingDetailSchema,
  bookingPageSchema,
  type BookingDetail,
  type BookingPage,
  type StaffTransition,
} from '@/api/schemas/booking-admin'
import { MAX_PAGE_SIZE } from '@/api/schemas/page'

/**
 * `GET /api/bookings`, `GET /api/bookings/{id}` and the one `PATCH` — the
 * calendar's whole surface.
 *
 * There is no `POST` and there is no reschedule, on the backend by design: a
 * booking is created by a customer through the public endpoint with a slot they
 * picked, and a business creating one would need its own override semantics for
 * the policy window and the cutoff. That absence is what decided this wave's
 * biggest choice — a drag-to-move calendar library has nothing to call, so the
 * grid is hand-built (F9).
 *
 * Every endpoint here is open to `OWNER` and `STAFF` alike, and none is scoped
 * by the caller's own id. A receptionist books for the whole salon, so the
 * calendar shows the whole business whoever is looking — unlike the dashboard's
 * aggregate, which the server narrows by role.
 */

const BOOKINGS_PATH = '/api/bookings'

/**
 * The filters that make a week, all optional and all combining server-side.
 *
 * `from` and `to` are **instants**, and `to` is **exclusive** — the opposite of
 * `GET /api/dashboard/stats`, whose bounds are dates and both inclusive. Nothing
 * here builds them: `weekInstants` in `lib/time.ts` is the single conversion at
 * the edge that both screens import, because getting the two conventions the
 * same way round is a silently wrong week rather than an error.
 */
export type BookingQuery = {
  from?: string
  to?: string
  status?: string
  staffId?: string
  page?: number
  size?: number
}

/**
 * Hierarchical, so that a status change can invalidate every week of the
 * calendar without naming one — which is what `onSettled` actually wants. A
 * booking moving to `CANCELLED` changes the week it is in, and nothing else
 * knows which week that was by the time the response lands.
 */
export const bookingKeys = {
  all: ['bookings'] as const,
  lists: () => ['bookings', 'list'] as const,
  list: (query: BookingQuery) => ['bookings', 'list', query] as const,
  details: () => ['bookings', 'detail'] as const,
  detail: (id: string) => ['bookings', 'detail', id] as const,
}

/**
 * The cap a week is fetched under, and it is **not** the plan's 200.
 *
 * `PaginationConfig.MAX_PAGE_SIZE` is 100 and clamps *silently* — `?size=200`
 * comes back `"size": 100` with no error, verified on the running stack in wave
 * 5 for the catalogue. Asking for 200 would make this call state something the
 * server does not honour, and would leave the `totalPages` check below reading
 * as belt-and-braces when it is in fact the only thing standing between a busy
 * week and a day going missing. Recorded as a deviation in the wave's decisions.
 */
export const WEEK_PAGE_SIZE = MAX_PAGE_SIZE

/**
 * A week with more than one page of bookings, refused rather than rendered.
 *
 * The plan asks for `totalPages === 1` to be asserted, and it is an assertion
 * rather than a `console.error` — which is the opposite of what the reference
 * lookups do, deliberately. A truncated *catalogue* renders a handful of
 * bookings without a service name, which is visibly odd. A truncated *week*
 * renders as a calendar: correct-looking, complete-looking, and missing
 * Thursday afternoon. There is no version of that a person can see, so it must
 * not be a thing they are shown.
 *
 * A real business with a hundred appointments in one week is a real paging task
 * and a later wave's; what this guarantees is that it arrives as an error
 * message naming the problem rather than as a quiet omission.
 */
export class WeekTooLargeError extends Error {
  readonly totalElements: number
  readonly totalPages: number

  constructor(page: BookingPage) {
    super(
      `This week has ${page.totalElements} bookings across ${page.totalPages} pages, and the calendar can only show the first ${page.size}. Filter by staff member to narrow it.`,
    )
    this.name = 'WeekTooLargeError'
    this.totalElements = page.totalElements
    this.totalPages = page.totalPages
  }
}

/** One page of bookings, exactly as asked for. The list view's fetch. */
export async function fetchBookingPage(
  query: BookingQuery,
  signal?: AbortSignal,
): Promise<BookingPage> {
  // Axios drops `undefined` params, which is what keeps an unset filter from
  // becoming `staffId=undefined` on the query string.
  const response = await client.get(BOOKINGS_PATH, { params: query, signal })
  return bookingPageSchema.parse(response.data)
}

/**
 * Every booking in one week, or an error saying why there is no such thing.
 *
 * `size` is sent explicitly rather than left to the server's default of 20,
 * which would turn an ordinary Tuesday into a truncated one.
 */
export async function fetchWeek(query: BookingQuery, signal?: AbortSignal) {
  const page = await fetchBookingPage({ ...query, page: 0, size: WEEK_PAGE_SIZE }, signal)
  if (page.totalPages > 1) throw new WeekTooLargeError(page)
  return page.content
}

/**
 * One booking in full — the only call in the app that returns a guest's email
 * address and phone number.
 *
 * Which is why it is a separate request rather than more fields on the list: a
 * day view shows forty rows, and a leak should have one place to happen rather
 * than forty. Another tenant's id answers `404` rather than `403`, because a
 * `403` would confirm that the booking exists somewhere.
 */
export async function fetchBookingDetail(id: string, signal?: AbortSignal): Promise<BookingDetail> {
  const response = await client.get(`${BOOKINGS_PATH}/${encodeURIComponent(id)}`, { signal })
  return bookingDetailSchema.parse(response.data)
}

/**
 * `PATCH /api/bookings/{id}/status` — the only mutation in this wave, and the
 * only optimistic one in the project (F14).
 *
 * It answers with the whole booking rather than `204`, which is load-bearing on
 * this side: the optimistic patch guessed one field, and the response carries
 * `updatedAt` and whatever else moved with it. So the result is parsed and
 * written back, not discarded.
 *
 * Refusals arrive as `409 ILLEGAL_TRANSITION` carrying `from` and `to` as
 * problem members — both states, because a client that optimistically flipped a
 * badge needs to know what the server thinks the status is, not only that it
 * said no.
 */
export async function patchBookingStatus(
  id: string,
  status: StaffTransition,
  signal?: AbortSignal,
): Promise<BookingDetail> {
  const response = await client.patch(
    `${BOOKINGS_PATH}/${encodeURIComponent(id)}/status`,
    { status },
    { signal },
  )
  return bookingDetailSchema.parse(response.data)
}
