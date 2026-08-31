import { useMutation, useQuery } from '@tanstack/react-query'

import {
  bookingKeys,
  fetchBookingDetail,
  fetchBookingPage,
  fetchWeek,
  WeekTooLargeError,
  type BookingQuery,
} from '@/api/bookings'
import { fetchPolicy, policyKeys } from '@/api/policy'
import { shouldRetry } from '@/api/query-client'
import { fetchBusiness, publicKeys } from '@/api/public'
import { GRID_FALLBACK_MINUTES } from '@/api/schemas/policy'
import { REFERENCE_STALE_TIME } from '@/hooks/use-lookups'
import { dayKeyOf, weekInstants, type DayKey, type DayRange } from '@/lib/time'
import type { BookingStatus } from '@/types'

/**
 * Every read the calendar makes, and the cache policy each one wants.
 *
 * The week itself is the only one that is not reference data. The policy, the
 * opening hours and the lookups all change when an owner edits a settings
 * screen, which is not while somebody is paging through weeks; the bookings
 * change because a customer took a slot thirty seconds ago on the public site,
 * which is exactly while somebody is looking at them.
 */

export type CalendarFilters = {
  staffId?: string
  status?: BookingStatus
}

/** The filters as the API takes them. One place, so the key and the request agree. */
function queryFor(week: DayRange, timeZone: string, filters: CalendarFilters): BookingQuery {
  return {
    // The single conversion at the edge (F8). `to` is exclusive here and
    // inclusive on the dashboard, and neither screen builds an instant itself.
    ...weekInstants(week, timeZone),
    staffId: filters.staffId,
    status: filters.status,
  }
}

/**
 * One week of bookings, filtered.
 *
 * `refetchOnWindowFocus` is on, against the app-wide default of off — the same
 * exception the dashboard takes, and for a stronger reason. This screen is left
 * open on a counter all day while bookings arrive on it from the public site,
 * and a calendar that is quietly twenty minutes stale is worse than no calendar.
 *
 * **No `placeholderData`.** Keeping last week's tiles on screen while the next
 * week loads would leave the grid's date headers describing one week and its
 * contents another, which on a calendar is not a nicety — it is somebody reading
 * Tuesday's appointments under Wednesday's heading.
 */
export function useWeekBookings(
  week: DayRange,
  timeZone: string,
  filters: CalendarFilters,
  options?: { enabled?: boolean },
) {
  const query = queryFor(week, timeZone, filters)

  return useQuery({
    queryKey: bookingKeys.list(query),
    queryFn: ({ signal }) => fetchWeek(query, signal),
    refetchOnWindowFocus: true,
    enabled: options?.enabled !== false,
    /**
     * A week too large is a refusal, not a failure, and asking again is two more
     * round trips before the identical answer. Everything else defers to the
     * app-wide rule rather than restating it — which is why that predicate is
     * exported.
     *
     * Without this the error state arrives seconds after the request did, and on
     * a screen somebody is waiting on that reads as a hang.
     */
    retry: (failureCount, error) =>
      !(error instanceof WeekTooLargeError) && shouldRetry(failureCount, error),
  })
}

/** One page of the list view. Paged and filtered in the URL, so a page is linkable. */
export function useBookingList(
  week: DayRange,
  timeZone: string,
  filters: CalendarFilters,
  page: number,
  size: number,
  options?: { enabled?: boolean },
) {
  const query = { ...queryFor(week, timeZone, filters), page, size }

  return useQuery({
    queryKey: bookingKeys.list(query),
    queryFn: ({ signal }) => fetchBookingPage(query, signal),
    refetchOnWindowFocus: true,
    // Guarded from the other side too. Only one of the three views is ever on
    // screen, and without this a week grid also fetches a page of list rows
    // nothing will render — a second request per week paged through.
    enabled: options?.enabled !== false,
  })
}

/**
 * One booking in full, for the sheet.
 *
 * Fetched on open rather than prefetched on hover. It is the only call that
 * returns a guest's email address and phone number, and speculatively pulling
 * forty of those into a cache because a pointer crossed them is the opposite of
 * the reason the backend split the endpoint in two.
 */
export function useBookingDetail(id: string | undefined) {
  return useQuery({
    queryKey: bookingKeys.detail(id ?? ''),
    queryFn: ({ signal }) => fetchBookingDetail(id as string, signal),
    enabled: Boolean(id),
  })
}

/**
 * The grid's row pitch, from `GET /api/policy`.
 *
 * Returns a number and never an error, because a calendar that will not draw
 * because it could not read a ruling preference is a worse screen than one
 * ruled at fifteen minutes. Bookings are positioned against the day's real
 * length and never consult this, so the fallback misplaces nothing — see
 * {@link GRID_FALLBACK_MINUTES}.
 */
export function useGridMinutes(): number {
  const policy = useQuery({
    queryKey: policyKeys.all,
    queryFn: ({ signal }) => fetchPolicy(signal),
    staleTime: REFERENCE_STALE_TIME,
  })

  return policy.data?.slotGranularityMinutes ?? GRID_FALLBACK_MINUTES
}

/**
 * The business's opening hours, for the shading behind the grid.
 *
 * From the **public** endpoint, which is the only place they exist: they are the
 * union hull of the active staff's working hours (backend D5) and are published
 * on `PublicBusinessResponse` and on no admin resource. Reading a tenant's own
 * public page from inside the admin is not a workaround — it is the same data
 * the customer sees, and having the shading agree with what a customer is
 * offered is the point of drawing it.
 *
 * Shared cache key with wave 3's landing page, so an owner previewing their own
 * booking page and then opening the calendar makes one request, not two.
 */
export function useOpeningHours(slug: string) {
  return useQuery({
    queryKey: publicKeys.business(slug),
    queryFn: ({ signal }) => fetchBusiness(slug, signal),
    staleTime: REFERENCE_STALE_TIME,
  })
}

/**
 * "Jump to the nearest week that has bookings" — the empty week's one action.
 *
 * A mutation rather than a query because it is a thing a person asks for, once,
 * by pressing a button; there is nothing to keep fresh and nothing to refetch.
 *
 * **Forward first, then back.** An empty week is far more often ahead of the
 * business than behind it, and forward is one request: ask for the first booking
 * starting at or after this week's end. Backward costs two, because the endpoint
 * orders ascending and does not honour `?sort=` — so the last booking before
 * this week is the last row of the last page, which means asking for the page
 * count and then asking for that page. Both requests carry `size=1`; the row is
 * wanted for its date and nothing else.
 */
export function useNearestWeekSearch(
  week: DayRange,
  timeZone: string,
  filters: CalendarFilters,
  onFound: (day: DayKey) => void,
) {
  return useMutation({
    mutationFn: async (): Promise<DayKey | null> => {
      const bounds = weekInstants(week, timeZone)
      const scope = { staffId: filters.staffId, status: filters.status, size: 1, page: 0 }

      const ahead = await fetchBookingPage({ ...scope, from: bounds.to })
      const next = ahead.content[0]
      if (next) return dayKeyOf(next.startsAt, timeZone)

      // `to` is exclusive, so this week's own bookings — of which there are
      // none, or we would not be here — cannot be found by looking backwards.
      const behindCount = await fetchBookingPage({ ...scope, to: bounds.from })
      if (behindCount.totalPages === 0) return null

      const lastPage = await fetchBookingPage({
        ...scope,
        to: bounds.from,
        page: behindCount.totalPages - 1,
      })
      const previous = lastPage.content[0]
      return previous ? dayKeyOf(previous.startsAt, timeZone) : null
    },
    onSuccess: (day) => {
      if (day) onFound(day)
    },
  })
}
