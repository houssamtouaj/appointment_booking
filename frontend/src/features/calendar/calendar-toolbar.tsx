import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { CalendarFilters } from '@/features/calendar/calendar-filters'
import { VIEWS, type CalendarParams, type CalendarView } from '@/features/calendar/calendar-params'
import type { Lookups } from '@/hooks/use-lookups'
import { addDays, formatDayHeading, formatRange, weekOf } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useTranslation, type TKey } from '@/i18n'

/**
 * What is on screen, and how to change it — all of it writing to the URL.
 *
 * Every control here sets a query parameter rather than component state, which
 * is what makes "filter by staff, copy the URL, open it in a new tab" a demo
 * step rather than a wish. It also means the browser's own back button walks
 * back through the weeks somebody paged through, which is the behaviour people
 * try first and are surprised not to get.
 */

const VIEW_LABEL: Record<CalendarView, TKey> = {
  week: 'calendar.view.week',
  day: 'calendar.view.day',
  list: 'calendar.view.list',
}

type ToolbarProps = {
  params: CalendarParams
  /**
   * The view actually on screen, which is **not** always `params.view`: below
   * 768px a chosen week is drawn as a day. The arrows have to step whatever is
   * being looked at, or a phone gets a "Next week" button above a single day's
   * columns.
   */
  view: CalendarView
  lookups: Lookups
  /** True while the viewport is too narrow for seven columns — the week button says so. */
  weekUnavailable: boolean
}

export function CalendarToolbar({ params, view, lookups, weekUnavailable }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StepControl params={params} view={view} />
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
function StepControl({ params, view }: { params: CalendarParams; view: CalendarView }) {
  const { t } = useTranslation()
  // The *effective* view, not the chosen one. A phone showing the day grid under
  // a URL that still says `view=week` must still step by a day.
  const byDay = view === 'day'
  const step = (direction: number) =>
    params.setDate(
      byDay
        ? addDays(params.date, direction)
        : weekOf(addDays(params.week.from, direction * 7)).from,
    )

  const unit = t(byDay ? 'calendar.unitDay' : 'calendar.unitWeek')

  return (
    <div className="border-border bg-card flex items-center rounded-sm border">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('calendar.previous', { unit })}
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

      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('calendar.next', { unit })}
        onClick={() => step(1)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  )
}

/**
 * Week / Day / List — one screen, three presentations, not three routes.
 *
 * A radio group rather than three buttons or a `<select>`: these are mutually
 * exclusive views of one thing, which is what `radiogroup` means.
 *
 * **The keyboard model is written here rather than inherited.** Native `<input
 * type="radio">`s get roving focus and arrow-key selection from the platform;
 * the ARIA *role* on a `<button>` gets none of it, and a radiogroup where the
 * arrows do nothing and every option is its own tab stop is a role that promises
 * behaviour it does not have. So: one tab stop on the checked option, arrows
 * move and select, disabled options are stepped over.
 *
 * **The week option refuses itself below 768px** rather than disappearing. A
 * control that vanishes at a breakpoint leaves a person who was using it
 * wondering what they did wrong; one that is present and explains itself does
 * not. It is also honest about what is happening — the day view on a phone is a
 * degradation of the week view, not a different feature.
 *
 * **`aria-disabled`, not `disabled`, and the reason in text.** The explanation
 * used to be a `title` on a `disabled` button, which is the one place it cannot
 * be reached: a disabled button is not focusable, so no keyboard or screen-reader
 * user meets it; there is no hover on touch, and touch below 768px is the only
 * context where the option is refused at all; and `title` on a disabled control
 * is announced inconsistently at best. So the button stays focusable and
 * announced, the click is ignored, and the sentence is rendered beside the group
 * and pointed at with `aria-describedby` — which is what the sibling
 * `booking-sheet.tsx` already does for a refusing control, and what
 * `staff-row.tsx` does for the last owner.
 */
function ViewSwitch({
  params,
  weekUnavailable,
}: {
  params: CalendarParams
  weekUnavailable: boolean
}) {
  const { t } = useTranslation()
  const group = useRef<HTMLDivElement>(null)
  const available = VIEWS.filter((view) => !(view === 'week' && weekUnavailable))
  // The single tab stop, and it is simply the checked option now: every button
  // here is focusable, including a refused one, so the group can no longer drop
  // out of the tab order by having its only stop disabled. A week chosen on a
  // laptop and reopened on a phone is checked *and* refused, and still reachable.
  const stop = params.view

  function move(from: CalendarView, step: number) {
    if (available.length === 0) return
    const at = available.indexOf(from)
    const next = available[(at + step + available.length) % available.length]
    if (!next || next === from) return

    params.setView(next)
    group.current?.querySelector<HTMLButtonElement>(`[data-view="${next}"]`)?.focus()
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        ref={group}
        role="radiogroup"
        aria-label={t('calendar.view.label')}
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
              data-view={view}
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              aria-describedby={disabled ? REASON_ID : undefined}
              tabIndex={view === stop ? 0 : -1}
              title={disabled ? t(WEEK_UNAVAILABLE_REASON) : undefined}
              // Ignored rather than prevented by the platform: an `aria-disabled`
              // control is a real button, so the refusal has to be here.
              onClick={() => {
                if (disabled) return
                params.setView(view)
              }}
              onKeyDown={(event) => {
                const step =
                  event.key === 'ArrowRight' || event.key === 'ArrowDown'
                    ? 1
                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                      ? -1
                      : 0
                if (step === 0) return
                event.preventDefault()
                move(view, step)
              }}
              className={cn(
                'rounded-xs px-3 py-1 text-xs font-medium transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-40',
              )}
            >
              {t(VIEW_LABEL[view])}
            </button>
          )
        })}
      </div>

      {/* Rendered, not only tooltipped. This is the only context where the
          option is refused — touch, below 768px — and a `title` is exactly the
          thing that context has no way to show. */}
      {weekUnavailable ? (
        <p id={REASON_ID} className="text-muted-foreground text-2xs">
          {t(WEEK_UNAVAILABLE_REASON)}
        </p>
      ) : null}
    </div>
  )
}

/** One sentence, in the tooltip, in the text, and in `aria-describedby`. */
const WEEK_UNAVAILABLE_REASON: TKey = 'calendar.view.weekUnavailable'
const REASON_ID = 'calendar-week-unavailable'
