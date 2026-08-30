import { useEffect, useRef } from 'react'

import { HOUR_REM, openBandOf, remToPx, type GridScale } from '@/features/calendar/grid-scale'
import type { GridColumn } from '@/features/calendar/time-grid'
import { minutesIntoDay } from '@/lib/time'
import type { OpeningHours } from '@/types'

/**
 * Open on the working day, not on midnight.
 *
 * The full day is scrollable on purpose — a booking taken before a policy change
 * can sit outside today's opening hours, and a grid cropped to the hull would
 * simply not show it. But *starting* at 00:00 means the first thing anybody sees
 * is seven hours of empty small hours with the entire day below the fold, which
 * reads as a calendar that failed to load. It is the same mistake as opening the
 * week picker on an empty week, one axis over, and it was found by looking at
 * the screen rather than at the tests — on the one the brief nominates as its
 * cover image.
 */
export function useGridScroll(
  columns: readonly GridColumn[],
  timeZone: string,
  openingHours: readonly OpeningHours[] | undefined,
  scale: GridScale,
) {
  const scroller = useRef<HTMLDivElement>(null)
  const anchor = openingMinuteOf(columns, timeZone, openingHours, scale)

  /**
   * Keyed on what is being shown rather than on every render.
   *
   * Re-anchoring on a refetch would yank the view out from under somebody who
   * had scrolled to the evening — and this screen refetches on window focus, so
   * that would happen every time they came back to the tab.
   */
  const anchorKey = `${columns[0]?.dayKey ?? ''}|${columns.length}|${anchor}`

  useEffect(() => {
    if (!scroller.current) return
    // Half an hour of air above, so the first appointment does not sit flush
    // against the header.
    scroller.current.scrollTop = remToPx(Math.max(0, anchor - 30) * (HOUR_REM / 60))
    // `anchorKey` carries `anchor`; depending on both would re-run on renders
    // where only the identity of the columns array changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey])

  return scroller
}

/**
 * The first minute of the day worth looking at.
 *
 * The earliest appointment on screen, or the start of opening hours, whichever
 * is earlier — so a 07:00 booking on a salon that opens at 09:00 is visible
 * without scrolling, and a quiet day still opens on the working day rather than
 * on the small hours. Falls back to 08:00 for a week with neither, which is
 * where a working day starts often enough to be a better guess than midnight.
 */
function openingMinuteOf(
  columns: readonly GridColumn[],
  timeZone: string,
  openingHours: readonly OpeningHours[] | undefined,
  scale: GridScale,
): number {
  let earliest = Number.POSITIVE_INFINITY

  for (const column of columns) {
    for (const booking of column.bookings) {
      earliest = Math.min(earliest, minutesIntoDay(booking.startsAt, column.dayKey, timeZone))
    }
    const band = openBandOf(column.dayKey, openingHours, timeZone, scale)
    if (band) earliest = Math.min(earliest, pxOfRem(band.top) * (60 / HOUR_REM))
  }

  return Number.isFinite(earliest) ? Math.max(0, earliest) : DEFAULT_OPENING_MINUTE
}

const DEFAULT_OPENING_MINUTE = 8 * 60

/** `"31.5000rem"` back to 31.5. The band is built as a length; this reads it. */
function pxOfRem(length: string): number {
  return Number.parseFloat(length)
}
