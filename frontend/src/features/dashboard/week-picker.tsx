import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { shiftWeek, type DashboardWeek } from '@/features/dashboard/dashboard-queries'
import { formatRange } from '@/lib/time'

/**
 * Previous, next, and the way back to today.
 *
 * The range is spelled out rather than left to the arrows, because the figures
 * beside it are meaningless without knowing which seven days they cover — and it
 * is the *only* thing on screen that says so, `todayBookings` excepted. It sets
 * in the mono face for the same reason the calendar's hour column will: this is
 * the time axis, and the digits have to line up as the week changes underneath
 * them.
 *
 * "This week" appears only when it would do something. A control that is
 * permanently present and inert two thirds of the time teaches people to stop
 * looking at it.
 */
export function WeekPicker({ week }: { week: DashboardWeek }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="border-border bg-card flex items-center rounded-sm border">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous week"
          onClick={() => week.goTo(shiftWeek(week.range, -1))}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>

        {/* `aria-live`: the arrows change this text and nothing else moves, so a
            screen-reader user pressing "next week" would otherwise get no
            acknowledgement that anything happened at all. */}
        <p
          aria-live="polite"
          className="text-foreground min-w-[11.5rem] px-1 text-center font-mono text-xs"
        >
          {formatRange(week.range)}
        </p>

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next week"
          onClick={() => week.goTo(shiftWeek(week.range, 1))}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>

      {week.isCurrent ? null : (
        <Button variant="outline" size="sm" onClick={() => week.goTo(week.current)}>
          This week
        </Button>
      )}
    </div>
  )
}
