import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { bookingStatusSchema } from '@/api/schemas/booking'
import { uuid } from '@/api/schemas/common'
import { isDayKey, todayIn, weekOf, type DayKey, type DayRange } from '@/lib/time'
import type { BookingStatus } from '@/types'

/**
 * Everything about what the calendar is showing, in the URL.
 *
 * **Three views, one screen, one route.** The brief allots nine screens and the
 * calendar is one of them; week, day and list are three presentations of the
 * same week of data, not three destinations. Putting the choice in the query
 * string rather than in `useState` is what makes a filtered week something a
 * person can send to a colleague — which is a demo step — and what makes the
 * back button walk back through the days somebody paged through.
 *
 * The parameter names are deliberately short and readable, because they end up
 * in a URL somebody reads: `?view=day&date=2026-09-03&staff=<id>`.
 */

export const VIEW_PARAM = 'view'
export const DATE_PARAM = 'date'
export const STAFF_PARAM = 'staff'
export const STATUS_PARAM = 'status'
export const BOOKING_PARAM = 'booking'
export const PAGE_PARAM = 'page'

export const VIEWS = ['week', 'day', 'list'] as const

export type CalendarView = (typeof VIEWS)[number]

function isView(raw: string | null): raw is CalendarView {
  return raw !== null && (VIEWS as readonly string[]).includes(raw)
}

export type CalendarParams = {
  view: CalendarView
  /**
   * The day the screen is anchored on. The week view shows the week containing
   * it; the day view shows it; the list pages from its week.
   *
   * **Always today unless the URL says otherwise** — never the first week that
   * has bookings, and never a remembered one. The demo's data clusters in the
   * last three weeks and the next two, and a picker that opens anywhere but
   * today makes the portfolio screenshot look broken.
   */
  date: DayKey
  /** Monday to Sunday containing {@link date}. Both bounds are dates, inclusive. */
  week: DayRange
  /** The week containing today, for the "This week" control. */
  currentWeek: DayRange
  isCurrentWeek: boolean

  staffId?: string
  status?: BookingStatus
  /** The booking whose sheet is open, deep-linked so a dashboard row can open it. */
  bookingId?: string
  /** Zero-based, list view only. */
  page: number

  setView: (view: CalendarView) => void
  setDate: (date: DayKey, options?: { replace?: boolean }) => void
  setFilters: (filters: { staffId?: string; status?: BookingStatus }) => void
  setPage: (page: number) => void
  openBooking: (id: string) => void
  closeBooking: () => void
}

export function useCalendarParams(timeZone: string): CalendarParams {
  const [params, setParams] = useSearchParams()

  // Memoised on the *day*, not on the zone. `todayIn` reads the clock, and
  // freezing "today" at mount is wrong on precisely this screen — the one an
  // owner leaves open all morning. Keying on the day key keeps `currentWeek` a
  // stable reference for as long as it is still today and lets it move when the
  // date does.
  const today = todayIn(timeZone)
  const currentWeek = useMemo(() => weekOf(today), [today])

  const requestedDate = params.get(DATE_PARAM)
  const date = requestedDate && isDayKey(requestedDate) ? requestedDate : today
  const week = useMemo(() => weekOf(date), [date])

  const rawView = params.get(VIEW_PARAM)
  const view: CalendarView = isView(rawView) ? rawView : 'week'

  const rawStatus = params.get(STATUS_PARAM)
  // Parsed rather than trusted. A hand-typed `?status=DONE` would otherwise
  // reach the API as a filter it answers 400 for, turning a typo in a URL into
  // an error screen instead of an ignored parameter.
  const status = bookingStatusSchema.safeParse(rawStatus).data
  // The same argument, and the same failure: `?staff=marc` is not a UUID, the
  // endpoint answers 400 for it, and a mistyped link would open on an error
  // screen rather than on the unfiltered week. Checked for shape only — whether
  // that id is a colleague of this tenant is the server's question, not one to
  // answer from a lookup table that may not have loaded yet.
  const staffId = uuid.safeParse(params.get(STAFF_PARAM)).data

  const rawPage = Number(params.get(PAGE_PARAM))
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 0

  /**
   * One writer for the whole query string, so that changing the view cannot
   * silently drop the staff filter. Every setter below goes through it with a
   * patch; a key set to `undefined` is deleted.
   */
  const patch = useCallback(
    (changes: Record<string, string | undefined>, options?: { replace?: boolean }) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          for (const [key, value] of Object.entries(changes)) {
            if (value === undefined) next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: options?.replace ?? false },
      )
    },
    [setParams],
  )

  const setView = useCallback(
    (next: CalendarView) => {
      // The page number belongs to the list and means nothing to a grid. Left
      // behind, it would be waiting on the way back — a person returns to the
      // list expecting the top of it and lands on page 4.
      patch({ [VIEW_PARAM]: next, [PAGE_PARAM]: undefined })
    },
    [patch],
  )

  const setDate = useCallback(
    (next: DayKey, options?: { replace?: boolean }) => {
      patch({ [DATE_PARAM]: next, [PAGE_PARAM]: undefined }, options)
    },
    [patch],
  )

  const setFilters = useCallback(
    (filters: { staffId?: string; status?: BookingStatus }) => {
      // Filtering resets the page for the same reason: page 4 of the unfiltered
      // week is very often past the end of the filtered one, and an empty state
      // that is really "you are past the end" is the least helpful screen there
      // is.
      patch({
        [STAFF_PARAM]: filters.staffId,
        [STATUS_PARAM]: filters.status,
        [PAGE_PARAM]: undefined,
      })
    },
    [patch],
  )

  const setPage = useCallback(
    (next: number) => patch({ [PAGE_PARAM]: next === 0 ? undefined : String(next) }),
    [patch],
  )

  const openBooking = useCallback((id: string) => patch({ [BOOKING_PARAM]: id }), [patch])

  // `replace`, unlike opening it. Opening a sheet is a place somebody navigated
  // to and Back should close it; closing it should not then leave a history
  // entry that Back re-opens, which is the loop that makes a deep-linked panel
  // feel broken.
  const closeBooking = useCallback(
    () => patch({ [BOOKING_PARAM]: undefined }, { replace: true }),
    [patch],
  )

  return {
    view,
    date,
    week,
    currentWeek,
    isCurrentWeek: week.from === currentWeek.from,
    staffId,
    status,
    bookingId: params.get(BOOKING_PARAM) ?? undefined,
    page,
    setView,
    setDate,
    setFilters,
    setPage,
    openBooking,
    closeBooking,
  }
}
