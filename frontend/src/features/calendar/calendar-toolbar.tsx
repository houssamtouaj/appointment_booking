import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CalendarFilters } from '@/features/calendar/calendar-filters'
import { VIEWS, type CalendarParams, type CalendarView } from '@/features/calendar/calendar-params'
import type { Lookups } from '@/hooks/use-lookups'
import { addDays, formatDayHeading, formatRange, weekOf } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * What is on screen, and how to change it — all of it writing to the URL.
 *
 * Every control here sets a query parameter rather than component state, which
 * is what makes "filter by staff, copy the URL, open it in a new tab" a demo
 * step rather than a wish. It also means the browser's own back button walks
 * back through the weeks somebody paged through, which is the behaviour people
 * try first and are surprised not to get.
 */

const VIEW_LABEL: Record<CalendarView, string> = {
  week: 'Week',
  day: 'Day',
  list: 'List',
}

type ToolbarProps = {
  params: CalendarParams
  lookups: Lookups
  /** True while the viewport is too narrow for seven columns — the week button says so. */
  weekUnavailable: boolean
}

export function CalendarToolbar({ params, lookups, weekUnavailable }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StepControl params={params} />
      {params.isCurrentWeek ? null : (
        <Button variant="outline" size="sm" onClick={() => params.setDate(params.currentWeek.from)}>
          Today
        </Button>
      )}
      <ViewSwitch params={params} weekUnavailable={weekUnavailable} />
      <CalendarFilters params={params} lookups={lookups} />
    </div>
  )
}

/**
 * Back and forward, by a week or by a day depending on what is on screen.
 *
 * The unit follows the view, because anything else is a control that lies: the
 * arrow beside a single day's columns has to move by a day. The label between
 * them is the range the arrows are moving, spelled out — it is the only thing on
 * screen that says which dates these appointments are, and it sets in the mono
 * face so the digits do not jump as the week changes underneath them.
 */
function StepControl({ params }: { params: CalendarParams }) {
  const byDay = params.view === 'day'
  const step = (direction: number) =>
    params.setDate(
      byDay
        ? addDays(params.date, direction)
        : weekOf(addDays(params.week.from, direction * 7)).from,
    )

  const unit = byDay ? 'day' : 'week'

  return (
    <div className="border-border bg-card flex items-center rounded-sm border">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Previous ${unit}`}
        onClick={() => step(-1)}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>

      {/* `aria-live`: pressing an arrow changes this text and, on a quiet week,
          nothing else. Without it a screen-reader user gets no acknowledgement
          that anything happened at all. */}
      <p
        aria-live="polite"
        className="text-foreground min-w-[11.5rem] px-1 text-center font-mono text-xs"
      >
        {byDay ? formatDayHeading(params.date) : formatRange(params.week)}
      </p>

      <Button variant="ghost" size="icon-sm" aria-label={`Next ${unit}`} onClick={() => step(1)}>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}

/**
 * Week / Day / List — one screen, three presentations, not three routes.
 *
 * A radio group rather than three buttons or a `<select>`: these are mutually
 * exclusive views of one thing, which is what `radiogroup` means, and it gets
 * arrow-key navigation from the platform for free.
 *
 * **The week option disables itself below 768px** rather than disappearing. A
 * control that vanishes at a breakpoint leaves a person who was using it
 * wondering what they did wrong; one that is present and explains itself does
 * not. It is also honest about what is happening — the day view on a phone is a
 * degradation of the week view, not a different feature.
 */
function ViewSwitch({
  params,
  weekUnavailable,
}: {
  params: CalendarParams
  weekUnavailable: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Calendar view"
      className="border-border bg-card flex items-center rounded-sm border p-0.5"
    >
      {VIEWS.map((view) => {
        const disabled = view === 'week' && weekUnavailable
        const selected = params.view === view

        return (
          <button
            key={view}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={disabled ? 'The week grid needs a wider screen' : undefined}
            onClick={() => params.setView(view)}
            className={cn(
              'rounded-xs px-3 py-1 text-xs font-medium transition-colors',
              selected
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-40',
            )}
          >
            {VIEW_LABEL[view]}
          </button>
        )
      })}
    </div>
  )
}
