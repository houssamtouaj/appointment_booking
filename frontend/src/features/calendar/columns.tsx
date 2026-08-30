import { staffNameIn, type Lookups } from '@/hooks/use-lookups'
import type { GridColumn } from '@/features/calendar/time-grid'
import {
  dayKeyOf,
  daysBetween,
  daysOfWeek,
  formatDayShort,
  formatWeekday,
  weekdayOf,
  type DayKey,
  type DayRange,
} from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingSummary } from '@/types'

/**
 * What a column *is* — the only thing the week view and the day view disagree
 * about, and therefore the only code that is not shared between them.
 *
 * Kept out of the two grid components so it can be asserted directly. Dealing
 * bookings into columns is where a timezone mistake becomes an appointment on
 * the wrong day, and testing that through a rendered grid means asserting on
 * pixels to find out about arithmetic.
 */

/**
 * The week's bookings, dealt into seven day columns.
 *
 * Grouped by `dayKeyOf` in the **business's** zone rather than by the viewer's,
 * which is the bug this whole app routes its time reads through one file to
 * avoid: a 23:40 Paris appointment read through a London browser lands on the
 * previous day, and on a calendar that is not a formatting slip, it is an
 * appointment on the wrong page.
 *
 * Exported so a test can assert the dealing without rendering a grid.
 */
export function weekColumns(
  week: DayRange,
  today: DayKey,
  bookings: readonly BookingSummary[],
  timeZone: string,
): GridColumn[] {
  const byDay = groupByDay(bookings, timeZone)

  return daysOfWeek(week).map((dayKey) => {
    const dayBookings = byDay.get(dayKey) ?? []
    const weekday = formatWeekday(weekdayOf(dayKey))
    const isToday = dayKey === today

    return {
      key: dayKey,
      dayKey,
      isToday,
      // The count is in the spoken label and not on screen: seven counts across
      // the top is a row of numbers competing with the dates, and the column
      // underneath already shows how full it is. A screen reader has no such
      // view, which is exactly why it is said there.
      label: `${weekday} ${formatDayShort(dayKey)}, ${countPhrase(dayBookings.length)}${
        isToday ? ', today' : ''
      }`,
      header: (
        <span className="block">
          <span
            className={cn(
              'text-2xs tracking-eyebrow block font-mono uppercase',
              isToday ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            {weekday.slice(0, 3)}
          </span>
          <span
            className={cn(
              'block text-sm',
              isToday ? 'text-primary font-medium' : 'text-foreground',
            )}
          >
            {formatDayShort(dayKey)}
          </span>
        </span>
      ),
      bookings: dayBookings,
    }
  })
}

/**
 * Bookings to days, sorted by start.
 *
 * Sorted by **instant**, with the id as the tiebreak — the same order the API
 * uses, which matters more than it looks: the keyboard walks a column in this
 * order, and two colleagues genuinely do start at 09:00, so without a stable
 * second key the arrow keys would visit them in a different order after every
 * refetch.
 */
function groupByDay(
  bookings: readonly BookingSummary[],
  timeZone: string,
): Map<DayKey, BookingSummary[]> {
  const days = new Map<DayKey, BookingSummary[]>()

  for (const booking of bookings) {
    // A booking belongs to the day it **starts** on. That is a decision, not an
    // obvious truth: an appointment running 23:30 to 00:30 touches two days. It
    // is drawn once, from its start, and clipped by the column — drawing it
    // twice would double every count on the screen, and filing it under the day
    // it ends would move every late booking to tomorrow.
    const key = dayKeyOf(booking.startsAt, timeZone)
    const bucket = days.get(key)
    if (bucket) bucket.push(booking)
    else days.set(key, [booking])
  }

  for (const bucket of days.values()) {
    bucket.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : 1))
  }
  return days
}

function countPhrase(count: number): string {
  if (count === 0) return 'no appointments'
  return `${count} appointment${count === 1 ? '' : 's'}`
}

/**
 * The day's bookings, dealt into one column per colleague.
 *
 * Columns are ordered by the colleague's name rather than by how busy they are,
 * so a person's column is in the same place on Tuesday as it was on Monday.
 * Ordering by count would reshuffle the screen daily, and muscle memory is most
 * of what makes a calendar fast to use.
 *
 * Exported so the dealing can be asserted without rendering a grid.
 */
export function dayColumns(
  date: DayKey,
  today: DayKey,
  bookings: readonly BookingSummary[],
  timeZone: string,
  lookups: Lookups,
): GridColumn[] {
  const onThisDay = bookings.filter((booking) => dayKeyOf(booking.startsAt, timeZone) === date)

  const byStaff = new Map<string, BookingSummary[]>()
  for (const booking of onThisDay) {
    const bucket = byStaff.get(booking.staffId)
    if (bucket) bucket.push(booking)
    else byStaff.set(booking.staffId, [booking])
  }

  // A day nobody is working still needs a column, or the grid has none and the
  // ruling collapses to a bare gutter. It carries the whole day, empty.
  if (byStaff.size === 0) {
    return [
      {
        key: 'empty',
        dayKey: date,
        isToday: date === today,
        label: 'No appointments',
        header: <span className="text-muted-foreground text-sm">No appointments</span>,
        bookings: [],
      },
    ]
  }

  return [...byStaff.entries()]
    .map(([staffId, staffBookings]) => {
      const name = staffNameIn(lookups, staffId)
      staffBookings.sort(
        (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : 1),
      )

      return {
        key: staffId,
        dayKey: date,
        isToday: date === today,
        label: `${name}, ${staffBookings.length} appointment${staffBookings.length === 1 ? '' : 's'}`,
        header: (
          <span className="text-foreground block truncate text-sm font-medium" title={name}>
            {name}
          </span>
        ),
        bookings: staffBookings,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The day nearest `date` that has something on it, preferring later.
 *
 * Later on a tie because a calendar is read forwards: somebody landing on an
 * empty Sunday is far more often asking what is coming than what they missed.
 */
export function nearestBusyDay(
  date: DayKey,
  bookings: readonly BookingSummary[],
  timeZone: string,
): DayKey | undefined {
  const days = [...new Set(bookings.map((booking) => dayKeyOf(booking.startsAt, timeZone)))]

  let best: DayKey | undefined
  let bestDistance = Number.POSITIVE_INFINITY

  for (const day of days) {
    const distance = daysBetween(date, day)
    const rank = Math.abs(distance) * 2 + (distance < 0 ? 1 : 0)
    if (rank < bestDistance) {
      bestDistance = rank
      best = day
    }
  }
  return best
}
