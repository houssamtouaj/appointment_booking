import { CalendarSearch } from 'lucide-react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { formatDayHeading, type DayKey } from '@/lib/time'

/**
 * A week with nothing in it, offering the nearest one that has something.
 *
 * The same "do something" empty state as wave 3's slot picker, and on this demo
 * it will absolutely be seen: 46 bookings cluster across five weeks, so paging
 * two weeks in either direction lands on a blank grid. A blank grid with no
 * explanation is indistinguishable from a calendar that failed to load, which is
 * the worst thing the portfolio's cover screen could do.
 *
 * The search runs only when asked. It costs up to three requests (see
 * `useNearestWeekSearch`) and firing it automatically on every empty week would
 * mean paging through a quiet month issues a dozen of them — and would also take
 * the screen away from somebody who was deliberately looking at next week to see
 * that it was free.
 */

type EmptyWeekProps = {
  /** True when a colleague or a status is narrowing the week. */
  filtered: boolean
  onClearFilters: () => void
  onFindNearest: () => void
  searching: boolean
  /** True once a search has come back with nothing anywhere. */
  searchedAndFoundNothing: boolean
  /** The tenant's public page — where a business with no bookings at all gets its first. */
  slug: string
}

export function EmptyWeek({
  filtered,
  onClearFilters,
  onFindNearest,
  searching,
  searchedAndFoundNothing,
  slug,
}: EmptyWeekProps) {
  // A filtered empty week is a different fact from an empty one, and offering
  // "find the nearest week" first would send somebody to another week that is
  // also empty for the same reason. The filter is the thing to undo.
  if (filtered) {
    return (
      <EmptyState
        icon={CalendarSearch}
        title="Nothing matches these filters this week"
        description="There may be appointments this week for other colleagues, or with a different status."
        action={
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        }
      />
    )
  }

  if (searchedAndFoundNothing) {
    return (
      <EmptyState
        icon={CalendarSearch}
        title="No appointments anywhere yet"
        description="Nothing is booked before or after this week either. The booking page is where the first one comes from."
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={`/b/${slug}`}>Open the booking page</Link>
          </Button>
        }
      />
    )
  }

  return (
    <EmptyState
      icon={CalendarSearch}
      title="Nothing booked this week"
      description="The week is free. Jump to the nearest week that has appointments, or use the arrows to look around."
      action={
        <Button variant="outline" size="sm" disabled={searching} onClick={onFindNearest}>
          {searching ? 'Looking…' : 'Find the nearest week'}
        </Button>
      }
    />
  )
}

/**
 * A quiet day in a week that is not quiet — the day view's own empty state.
 *
 * It exists because of what the day view is for. Below 768px the week grid
 * degrades to this one, so a phone opened on a Sunday shows an empty column
 * while the week behind it has forty appointments on it, and nothing on screen
 * says which of the two situations this is. That is the same ambiguity the empty
 * week resolves, one level down.
 *
 * The jump costs no request. The week's bookings are already loaded — the day
 * view is a filter over them, not a separate fetch — so the nearest busy day is
 * arithmetic the page already has the answer to.
 */
export function EmptyDay({
  nearestDay,
  onGoToDay,
}: {
  /** The closest day this week with something on it, if there is one. */
  nearestDay?: DayKey
  onGoToDay: (day: DayKey) => void
}) {
  return (
    <EmptyState
      icon={CalendarSearch}
      title="Nothing booked on this day"
      description={
        nearestDay
          ? 'This day is free. There are appointments elsewhere this week.'
          : 'This day is free, and so is the rest of this week.'
      }
      action={
        nearestDay ? (
          <Button variant="outline" size="sm" onClick={() => onGoToDay(nearestDay)}>
            Go to {formatDayHeading(nearestDay)}
          </Button>
        ) : undefined
      }
    />
  )
}
