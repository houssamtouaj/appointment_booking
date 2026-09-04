import { CalendarSearch } from 'lucide-react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { formatDayHeading, type DayKey } from '@/lib/time'
import { useTranslation } from '@/i18n'

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
  const { t } = useTranslation()
  // A filtered empty week is a different fact from an empty one, and offering
  // "find the nearest week" first would send somebody to another week that is
  // also empty for the same reason. The filter is the thing to undo.
  if (filtered) {
    return (
      <EmptyState
        icon={CalendarSearch}
        title={t('calendar.empty.filteredTitle')}
        description={t('calendar.empty.filteredBody')}
        action={
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            {t('calendar.filters.clear')}
          </Button>
        }
      />
    )
  }

  if (searchedAndFoundNothing) {
    return (
      <EmptyState
        icon={CalendarSearch}
        title={t('calendar.empty.neverTitle')}
        description={t('calendar.empty.neverBody')}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to={`/b/${slug}`}>{t('calendar.empty.openBookingPage')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <EmptyState
      icon={CalendarSearch}
      title={t('calendar.empty.weekTitle')}
      description={t('calendar.empty.weekBody')}
      action={
        <Button variant="outline" size="sm" disabled={searching} onClick={onFindNearest}>
          {searching ? t('calendar.empty.looking') : t('calendar.empty.findNearest')}
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
  const { t } = useTranslation()
  return (
    <EmptyState
      icon={CalendarSearch}
      title={t('calendar.empty.dayTitle')}
      description={
        nearestDay ? t('calendar.empty.dayBodyElsewhere') : t('calendar.empty.dayBodyAlone')
      }
      action={
        nearestDay ? (
          <Button variant="outline" size="sm" onClick={() => onGoToDay(nearestDay)}>
            {t('calendar.empty.goToDay', { day: formatDayHeading(nearestDay) })}
          </Button>
        ) : undefined
      }
    />
  )
}
