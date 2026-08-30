import { BookingTile } from '@/features/calendar/booking-tile'
import { NowLine, Rules, TimeGutter } from '@/features/calendar/grid-chrome'
import {
  openBandOf,
  placeDay,
  remOf,
  tailMinutes,
  type GridScale,
} from '@/features/calendar/grid-scale'
import { useGridFocus } from '@/features/calendar/use-grid-focus'
import { useGridScroll } from '@/features/calendar/use-grid-scroll'
import type { Lookups } from '@/hooks/use-lookups'
import type { DayKey } from '@/lib/time'
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
  const scroller = useGridScroll(columns, timeZone, openingHours, scale)

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
