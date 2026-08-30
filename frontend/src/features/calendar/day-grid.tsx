import { dayColumns } from '@/features/calendar/columns'
import type { GridScale } from '@/features/calendar/grid-scale'
import { TimeGrid } from '@/features/calendar/time-grid'
import type { Lookups } from '@/hooks/use-lookups'
import type { DayKey } from '@/lib/time'
import type { BookingSummary, OpeningHours } from '@/types'

/**
 * One date, colleagues as columns — and the view the week grid degrades to
 * below 768px.
 *
 * That degradation is the reason this exists rather than a nice extra. Seven day
 * columns cannot fit on a 375px phone: at a legible column width the week is
 * 900px wide and has to be scrolled sideways, and a calendar you scroll sideways
 * to read is one where you cannot see Thursday and Friday at once, which is the
 * only reason to draw a week. So the small screen gets a different view rather
 * than a squeezed one — a demo step, and the reason `TimeGrid` takes
 * `fitColumns`.
 *
 * **Only colleagues who have something that day get a column.** A salon with six
 * staff and two working on a Tuesday would otherwise show four empty columns,
 * which at 375px is four columns' worth of width spent on nothing — and the
 * whole point of this view is that what is on screen fits.
 */

type DayGridProps = {
  date: DayKey
  today: DayKey
  bookings: readonly BookingSummary[]
  scale: GridScale
  timeZone: string
  lookups: Lookups
  openingHours?: readonly OpeningHours[]
  selectedId?: string
  onOpen: (id: string) => void
  loading?: boolean
  now?: Date
}

export function DayGrid({ date, today, bookings, ...rest }: DayGridProps) {
  const columns = dayColumns(date, today, bookings, rest.timeZone, rest.lookups)

  return <TimeGrid columns={columns} fitColumns {...rest} />
}
