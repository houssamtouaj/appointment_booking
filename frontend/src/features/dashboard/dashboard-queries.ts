import { useQuery } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

import { dashboardKeys, fetchDashboardStats } from '@/api/dashboard'
import { addDays, isDayKey, todayIn, weekOf, type DayRange } from '@/lib/time'

/**
 * The dashboard's one query, and the week it is asked about.
 *
 * Kept out of the page component because the range arithmetic is the part with a
 * bug in it if there is one: two endpoints in this API use `from`/`to` with
 * opposite conventions, and this is the inclusive-dates one.
 */

/** The parameter the picked week lives in, so a range is a link somebody can send. */
export const WEEK_PARAM = 'week'

export type DashboardWeek = {
  /** Monday to Sunday, **both inclusive** — the convention this endpoint reads. */
  range: DayRange
  /** The week containing today, in the business's zone. */
  current: DayRange
  isCurrent: boolean
  goTo: (range: DayRange) => void
}

/**
 * The shown week, in the URL.
 *
 * In the URL and not in `useState` for the reason wave 3 settled for the booking
 * flow: a range somebody navigated to should survive a reload and paste into a
 * message. Any day in the week is accepted and normalised to its Monday, so a
 * hand-typed `?week=2026-09-03` opens the week that contains it rather than
 * refusing.
 *
 * `weekOf` is Monday-first because the API sends opening hours Monday-first and
 * the availability endpoint frames its weeks the same way. A Sunday-first
 * dashboard would disagree with both about which seven days "this week" is.
 */
export function useDashboardWeek(timeZone: string): DashboardWeek {
  const [params, setParams] = useSearchParams()
  const requested = params.get(WEEK_PARAM)

  // Memoised on the *day*, not on the zone. `todayIn` reads the clock, and
  // memoising on the zone alone freezes "today" at mount — which is wrong on
  // precisely the screen this hook is for, the one an owner leaves open all
  // morning: come Monday the "This week" button would walk them back into last
  // week and the picker would insist they were already in it. Keying on the
  // day key keeps `current` a stable reference for as long as it is still
  // today, which is all the query key needs, and lets it move when the date
  // does. `todayIn` is a lookup in a cached formatter, so asking every render
  // costs nothing.
  const today = todayIn(timeZone)
  const current = useMemo(() => weekOf(today), [today])

  const range = useMemo(
    () => (requested && isDayKey(requested) ? weekOf(requested) : current),
    [requested, current],
  )

  const goTo = useCallback(
    (next: DayRange) => {
      setParams(
        (previous) => {
          const updated = new URLSearchParams(previous)
          updated.set(WEEK_PARAM, next.from)
          return updated
        },
        // A real history entry, not a replacement: paging back three weeks and
        // pressing back should walk forward through them, the way the booking
        // flow's steps do.
        { replace: false },
      )
    },
    [setParams],
  )

  return { range, current, isCurrent: range.from === current.from, goTo }
}

/**
 * `GET /api/dashboard/stats` for one week.
 *
 * **No `placeholderData`, deliberately.** Keeping the previous week's numbers on
 * screen while the next week loads is the usual kindness and it is wrong here:
 * the range is printed directly above the tiles, so the moment it changes the
 * header would be describing a week the figures underneath are not about. The
 * gate for this wave asks that the numbers and the range agree, and a
 * tile-shaped skeleton for one round trip is how they never disagree.
 *
 * `refetchOnWindowFocus` is on, against the app-wide default of off. Most screens
 * in this app are forms, where a refetch fights what is being typed; this one is
 * a read that an owner leaves open all morning while bookings arrive on it from
 * the public site.
 */
export function useDashboardStats(range: DayRange, timeZone: string) {
  const request = { ...range, tz: timeZone }

  return useQuery({
    queryKey: dashboardKeys.stats(request),
    queryFn: ({ signal }) => fetchDashboardStats(request, signal),
    refetchOnWindowFocus: true,
  })
}

/**
 * The week before or after the one shown.
 *
 * `weekOf` around the shifted Monday rather than `addDays` on both bounds: seven
 * days from a Monday is a Monday, so the two agree today — and they stop
 * agreeing the moment a `?week=` in the URL names some other day, which
 * `useDashboardWeek` normalises but a bare arithmetic shift would not.
 */
export function shiftWeek(range: DayRange, weeks: number): DayRange {
  return weekOf(addDays(range.from, weeks * 7))
}
