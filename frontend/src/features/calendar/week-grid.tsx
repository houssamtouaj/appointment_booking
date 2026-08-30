import { weekColumns } from '@/features/calendar/columns'
import type { GridScale } from '@/features/calendar/grid-scale'
import { TimeGrid } from '@/features/calendar/time-grid'
import type { Lookups } from '@/hooks/use-lookups'
import type { DayKey, DayRange } from '@/lib/time'
import type { BookingSummary, OpeningHours } from '@/types'

/**
 * Seven columns, Monday to Sunday. The screen §10 nominates as the cover image.
 *
 * Monday-first because the API sends opening hours Monday-first and the
 * availability endpoint frames its weeks the same way; a Sunday-first calendar
 * would disagree with both about which seven days "this week" is.
 *
 * Every day gets a column **including the ones with nothing in them**, which is
 * the difference between a calendar and a list. An empty Wednesday is
 * information — it is the day with room in it — and collapsing it away would
 * lose the one thing a week view is read for.
 */

type WeekGridProps = {
  week: DayRange
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

export function WeekGrid({ week, today, bookings, ...rest }: WeekGridProps) {
  const columns = weekColumns(week, today, bookings, rest.timeZone)

  return <TimeGrid columns={columns} {...rest} />
}
