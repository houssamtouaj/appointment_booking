import { WEEKDAYS, formatLocalTime, formatWeekday, todayIn, weekdayOf } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { OpeningHours } from '@/types'

type OpeningHoursTableProps = {
  hours: readonly OpeningHours[]
  timeZone: string
}

/**
 * The week the business is open, as a timetable.
 *
 * `openingHours` is the **union hull of the active staff's working hours**
 * (backend D5) — one row per day somebody is working, and no row at all for a
 * day nobody is. The demo sends six rows for seven days, so this renders all
 * seven and says "Closed" on the one that is missing. A gap would read as
 * missing data rather than as a shut door, and a customer's next question after
 * "are you open on Sunday" should not be "did the page finish loading".
 *
 * The rules between rows are the signature motif used where it is literally
 * true: this is a timetable, and time is its axis.
 */
export function OpeningHoursTable({ hours, timeZone }: OpeningHoursTableProps) {
  const byDay = new Map(hours.map((row) => [row.dayOfWeek, row]))
  const today = weekdayOf(todayIn(timeZone))

  return (
    <table className="w-full border-collapse text-sm">
      <caption className="sr-only">Opening hours, shown in the business&apos;s local time</caption>
      <tbody>
        {WEEKDAYS.map((weekday) => {
          const row = byDay.get(weekday)
          const isToday = weekday === today

          return (
            <tr key={weekday} className="border-rule border-b last:border-b-0">
              <th
                scope="row"
                className={cn(
                  'py-2 pr-4 text-left font-normal',
                  isToday ? 'text-foreground font-medium' : 'text-muted-foreground',
                )}
              >
                {formatWeekday(weekday)}
                {isToday ? (
                  <span className="text-primary text-2xs tracking-eyebrow ml-2 font-mono uppercase">
                    Today
                  </span>
                ) : null}
              </th>
              <td
                className={cn(
                  'py-2 text-right font-mono',
                  row ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {row ? (
                  <>
                    {formatLocalTime(row.opensAt)} – {formatLocalTime(row.closesAt)}
                    {/* A real flag on a real shift: a salon closing at 02:00 is
                        open past midnight, and without this the row reads as a
                        negative day. */}
                    {row.closesNextDay ? (
                      <span className="text-muted-foreground ml-1 font-sans text-xs">next day</span>
                    ) : null}
                  </>
                ) : (
                  'Closed'
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
