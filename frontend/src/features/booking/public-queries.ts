import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  fetchAvailability,
  fetchBusiness,
  fetchStaff,
  publicKeys,
  type AvailabilityRequest,
} from '@/api/public'
import { ANYONE } from '@/features/booking/booking-params'
import { MAX_RANGE_DAYS, addDays, weekOf, type DayKey, type DayRange } from '@/lib/time'

/**
 * The public endpoints as hooks, with the cache policy each one actually wants.
 *
 * Kept together rather than beside their screens because the landing page and
 * all three booking steps read the same business, and a second copy of that
 * query with a different `staleTime` is how one screen refetches what the
 * previous one already had.
 */

/**
 * Reference data. Five minutes rather than the app-wide thirty seconds: a
 * catalogue changes when an owner edits it, which is not while a customer is
 * moving between two steps of a booking.
 *
 * The same number as `hooks/use-lookups.ts`'s `REFERENCE_STALE_TIME`, and
 * deliberately not that constant. These are the *public* endpoints — a different
 * cache, reached by a stranger with no session, invalidated by nothing the admin
 * mutations touch — and sharing the constant would tie the two together at the
 * one place they are most likely to want to diverge: the admin side can afford a
 * long window because its writes invalidate on save, and this side cannot,
 * because the owner editing the catalogue is on another device entirely. Renamed
 * so that a reader who greps the number finds two answers and this paragraph.
 */
const PUBLIC_REFERENCE_STALE_TIME = 5 * 60_000

/**
 * Availability is not reference data. Someone else may take the slot being
 * looked at, so this keeps the app default and refetches on remount.
 */
const AVAILABILITY_STALE_TIME = 30_000

export function useBusiness(slug: string) {
  return useQuery({
    queryKey: publicKeys.business(slug),
    queryFn: ({ signal }) => fetchBusiness(slug, signal),
    staleTime: PUBLIC_REFERENCE_STALE_TIME,
  })
}

export function useStaffForService(slug: string, serviceId: string | undefined) {
  return useQuery({
    queryKey: publicKeys.staff(slug, serviceId ?? ''),
    // `skipToken` rather than `enabled: Boolean(serviceId)` with the id asserted
    // into place. Both disable the query; only this one is visible to the type
    // system, so the fetch cannot be reached without the value it needs and
    // nothing has to promise on its behalf.
    queryFn: serviceId ? ({ signal }) => fetchStaff(slug, serviceId, signal) : skipToken,
    staleTime: PUBLIC_REFERENCE_STALE_TIME,
  })
}

/**
 * Turn the flow's choices into a request.
 *
 * The one line worth reading twice is `staffId`: `ANYONE` becomes `undefined`,
 * never a member of the slot's `staffIds`. Sending a specific person when the
 * customer said they had no preference is how the server loses its ability to
 * balance the booking.
 */
export function availabilityRequest(
  range: DayRange,
  serviceId: string,
  staff: string,
  timeZone: string,
): AvailabilityRequest {
  return {
    ...range,
    serviceId,
    tz: timeZone,
    staffId: staff === ANYONE ? undefined : staff,
  }
}

export function useAvailability(
  slug: string,
  request: AvailabilityRequest | undefined,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: publicKeys.availability(slug, request),
    queryFn: request ? ({ signal }) => fetchAvailability(slug, request, signal) : skipToken,
    // Still an `enabled`, for the caller's own reason — the flow disables this
    // while a later step is on screen. What it no longer carries is the absence
    // of `request`, which `skipToken` above states in the type instead.
    enabled: options?.enabled !== false,
    staleTime: AVAILABILITY_STALE_TIME,
  })
}

/**
 * Warm the next week on hover or focus of the "next" control.
 *
 * **One week ahead, and only on intent.** Prefetching every week a pointer
 * crosses is worse than not prefetching at all on a slow connection: it puts a
 * week of slots the customer will never see in front of the week they are
 * waiting for, on the same connection. `fetchQuery` is deliberately not used —
 * `prefetchQuery` swallows its own errors, and a failed speculative fetch must
 * not surface as an error on a screen that is working.
 */
export function usePrefetchWeek(slug: string) {
  const queryClient = useQueryClient()

  return useCallback(
    (request: AvailabilityRequest) => {
      void queryClient.prefetchQuery({
        queryKey: publicKeys.availability(slug, request),
        queryFn: ({ signal }) => fetchAvailability(slug, request, signal),
        staleTime: AVAILABILITY_STALE_TIME,
      })
    },
    [queryClient, slug],
  )
}

/**
 * How far "Find the next opening" looks: 60 days from today, which is 61 days
 * inclusive and therefore inside the API's 62-day cap.
 *
 * Deliberately **not** the demo's `maxAdvanceDays`. That policy is not on any
 * public endpoint — neither `minLeadTimeHours` nor `maxAdvanceDays` appears in
 * `PublicBusinessResponse` — so the client cannot know it and must not pretend
 * to. It asks for a wide range and lets the server trim to whatever the business
 * actually allows, which is why no copy anywhere quotes a number of days.
 */
export const SEARCH_HORIZON_DAYS = 60

/** The widened one-shot search behind the empty state's action. */
export function nextOpeningRange(today: DayKey): DayRange {
  return { from: today, to: addDays(today, SEARCH_HORIZON_DAYS) }
}

/** The week a day sits in, which is the unit the picker fetches. */
export function weekRangeFor(day: DayKey): DayRange {
  return weekOf(day)
}

export { MAX_RANGE_DAYS }
