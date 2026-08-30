import { useEffect, useRef } from 'react'

import { BookingTile } from '@/features/calendar/booking-tile'
import { NowLine, Rules, TimeGutter } from '@/features/calendar/grid-chrome'
import {
  HOUR_REM,
  openBandOf,
  placeDay,
  remOf,
  remToPx,
  tailMinutes,
  type GridScale,
} from '@/features/calendar/grid-scale'
import { useGridFocus } from '@/features/calendar/use-grid-focus'
import type { Lookups } from '@/hooks/use-lookups'
import { minutesIntoDay, type DayKey } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingSummary, OpeningHours } from '@/types'

/**
 * The ruled page: a time gutter, N columns, and every appointment placed on it.
 *
 * One component for both views because they differ in exactly one thing — what a
 * column *is*. The week view passes seven columns, one per day. The day view
 * passes one column per colleague, all sharing a date. Everything below is the
 * same arithmetic either way, which is why there is no second copy of it to
 * drift.
 *
 * **On the `grid` role the plan asks for.** It is not used, and the deviation is
 * deliberate. `role="grid"` is a promise about structure — rows of cells, an
 * addressable cell at every intersection — and this surface cannot keep it:
 * appointments are absolutely positioned, they overlap, they span arbitrary
 * numbers of rows and they do not tile the plane. Honouring the role would mean
 * emitting 7 × 96 empty cells as scaffolding for a fiction, and a screen reader
 * navigating that grid would traverse hundreds of empty cells to find four
 * appointments. What is used instead is what the content actually is: a labelled
 * region per column, each announcing its date and its count, containing buttons
 * whose accessible names carry the time that position conveys visually. The
 * keyboard model the plan specifies is implemented in full either way — see
 * `use-grid-focus.ts`.
 */

export type GridColumn = {
  key: string
  /** The day this column's appointments are positioned within. */
  dayKey: DayKey
  /** What sits above the column. A date for the week view, a person for the day view. */
  header: React.ReactNode
  /** Spoken name for the column, including its count. */
  label: string
  /** Already sorted by start; the keyboard walks them in this order. */
  bookings: BookingSummary[]
  isToday?: boolean
}

type TimeGridProps = {
  columns: GridColumn[]
  scale: GridScale
  timeZone: string
  lookups: Lookups
  openingHours?: readonly OpeningHours[]
  selectedId?: string
  onOpen: (id: string) => void
  /**
   * Let the columns shrink to whatever is left rather than holding a floor and
   * scrolling sideways. The day view sets it, because it is the view that has to
   * work at 375px — seven day columns cannot, which is why the week view
   * degrades to this one rather than being scrolled.
   */
  fitColumns?: boolean
  /**
   * The week has not arrived yet.
   *
   * There is no tile-shaped skeleton here, deliberately: the grid *is* the
   * skeleton. The ruling, the gutter and the column headers are real, correct
   * and already on screen a round trip before the appointments, and shimmering
   * rectangles at guessed times would be inventing appointments that may not
   * exist. What a loading grid owes is to say so rather than to look like a
   * quiet week — which is what the two attributes below are for.
   */
  loading?: boolean
  /** Injected so a test can place the now line, and so it is not read per column. */
  now?: Date
}

export function TimeGrid({
  columns,
  scale,
  timeZone,
  lookups,
  openingHours,
  selectedId,
  onOpen,
  fitColumns = false,
  loading = false,
  now = new Date(),
}: TimeGridProps) {
  const focus = useGridFocus(columns)
  const height = remOf(scale.minutes)

  /**
   * Open on the working day, not on midnight.
   *
   * The full day is scrollable on purpose — a booking taken before a policy
   * change can sit outside today's opening hours, and a grid cropped to the hull
   * would simply not show it. But *starting* at 00:00 means the first thing
   * anybody sees is seven hours of empty small hours with the entire day below
   * the fold, which reads as a calendar that failed to load. It is the same
   * mistake as opening the week picker on an empty week, one axis over, and on
   * the screen the brief nominates as its cover image.
   *
   * The anchor is the earliest thing worth seeing — the first appointment, or
   * the start of opening hours, whichever comes first — with half an hour of
   * air above it so it does not sit flush against the header.
   */
  const scroller = useRef<HTMLDivElement>(null)
  const anchor = openingMinuteOf(columns, timeZone, openingHours, scale)
  // Keyed on what is being shown rather than on every render: re-anchoring on a
  // refetch would yank the view out from under somebody who had scrolled to the
  // evening.
  const anchorKey = `${columns[0]?.dayKey ?? ''}|${columns.length}|${anchor}`

  useEffect(() => {
    if (!scroller.current) return
    scroller.current.scrollTop = remToPx(Math.max(0, anchor - 30) * (HOUR_REM / 60))
    // `anchorKey` is the dependency; `anchor` is read through it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey])

  return (
    <div className="border-border bg-card overflow-hidden rounded-md border">
      {/* Announced without stealing focus. An empty grid and a still-loading one
          look identical, and only one of them means the week is free. */}
      <span role="status" className="sr-only">
        {loading ? 'Loading this week’s appointments' : ''}
      </span>

      <div ref={scroller} className="max-h-[70vh] overflow-auto" aria-busy={loading || undefined}>
        <div
          className={cn('grid', fitColumns ? 'w-full' : 'min-w-max')}
          // `minmax(…, 1fr)` rather than a bare `1fr` either way: `1fr`'s
          // implicit `auto` minimum lets a long guest name push its column wider
          // than its share, and a grid of text drifts. The floor is what differs
          // — 7rem holds a readable day column and scrolls sideways when seven of
          // them will not fit, while 0 lets the day view's columns divide
          // whatever a phone has.
          style={{
            gridTemplateColumns: fitColumns
              ? `2.75rem repeat(${columns.length}, minmax(0, 1fr))`
              : `4rem repeat(${columns.length}, minmax(7rem, 1fr))`,
          }}
        >
          {/* Headers, stuck to the top of the scroller so paging down a day
              never leaves a person wondering which column is which. */}
          <div className="bg-card border-rule sticky top-0 z-20 border-b" />
          {columns.map((column) => (
            <div
              key={column.key}
              className={cn(
                'bg-card border-rule sticky top-0 z-20 border-b border-l px-2 py-2',
                column.isToday && 'bg-primary-wash',
              )}
            >
              {column.header}
            </div>
          ))}

          <TimeGutter scale={scale} />

          {columns.map((column, columnIndex) => {
            const geometry = placeDay(column.bookings, column.dayKey, timeZone)
            const band = openBandOf(column.dayKey, openingHours, timeZone, scale)
            const tail = tailMinutes(column.dayKey, timeZone, scale)

            return (
              <section
                key={column.key}
                aria-label={column.label}
                className="border-rule relative border-l"
                style={{ height }}
              >
                {/* Working hours. Behind everything, and it is the only shading
                    on the column, so a tile always reads as a tile. */}
                {band ? (
                  <div aria-hidden="true" className="bg-muted/60 absolute inset-x-0" style={band} />
                ) : null}

                <Rules scale={scale} />

                {/* An hour this column's day does not have — see `buildScale`.
                    Hatched rather than blank, so it reads as "not here" instead
                    of as an empty evening. */}
                {tail > 0 ? (
                  <div
                    aria-hidden="true"
                    className="bg-muted absolute inset-x-0 bottom-0 opacity-70"
                    style={{ height: remOf(tail) }}
                  />
                ) : null}

                {column.isToday ? (
                  <NowLine dayKey={column.dayKey} timeZone={timeZone} now={now} />
                ) : null}

                {column.bookings.map((booking, index) => {
                  const position = { column: columnIndex, index }
                  const geo = geometry.get(booking.id)
                  if (!geo) return null

                  return (
                    <BookingTile
                      key={booking.id}
                      ref={focus.register(booking.id)}
                      booking={booking}
                      lookups={lookups}
                      timeZone={timeZone}
                      geometry={geo}
                      tabIndex={focus.tabIndexAt(position)}
                      selected={booking.id === selectedId}
                      onOpen={() => onOpen(booking.id)}
                      onKeyDown={(event) => focus.onKeyDown(event, position)}
                      onFocus={() => focus.onFocus(position)}
                    />
                  )
                })}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
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
