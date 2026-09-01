import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { rangeProblem, type ClockTime, type DraftDay } from '@/features/hours/hours-model'
import { formatWeekday } from '@/lib/time'
import { cn } from '@/lib/utils'

type DayRowProps = {
  day: DraftDay
  /** True when something on this row collides with something else in the week. */
  overlapping: boolean
  /** The week has hit the request's 70-range cap; no row may grow. */
  full: boolean
  disabled: boolean
  onToggle: () => void
  onAdd: () => void
  onRemove: (key: string) => void
  onChange: (key: string, edge: 'start' | 'end', value: ClockTime) => void
}

/**
 * One weekday, open or closed, with as many shifts as it takes.
 *
 * **A split shift is the normal case here, not an edge one.** A salon that closes
 * 12:00–14:00 is two ranges on one day, and a grid offering a single from/to per
 * weekday would be wrong for the business this demo models. So the row is a list
 * of ranges with its own Add, and the closed state is the empty list rather than
 * a separate flag — which is also exactly how the wire says it.
 *
 * `type="time"` rather than a bespoke picker: it is keyboard-complete for free,
 * it uses the platform's own 12/24-hour convention, and on a phone it opens the
 * OS time wheel. The value it produces is `HH:mm`, which is what the model
 * holds.
 */
export function DayRow({
  day,
  overlapping,
  full,
  disabled,
  onToggle,
  onAdd,
  onRemove,
  onChange,
}: DayRowProps) {
  const label = formatWeekday(day.dayOfWeek)
  const closed = day.ranges.length === 0

  return (
    <li
      className={cn(
        'border-rule grid gap-3 border-b py-4 last:border-b-0 sm:grid-cols-[9rem_1fr]',
        overlapping && 'bg-warning-wash/40',
      )}
    >
      <div className="flex items-center gap-3">
        {/* A checkbox rather than a switch: it is a value in a form that is
            saved with a button, not a setting that takes effect on click, and
            the two read differently to a screen reader. */}
        <Checkbox
          id={`open-${day.dayOfWeek}`}
          checked={!closed}
          disabled={disabled}
          onChange={onToggle}
        />
        <label
          htmlFor={`open-${day.dayOfWeek}`}
          className={cn(
            'text-sm font-medium select-none',
            closed ? 'text-muted-foreground' : 'text-foreground',
          )}
        >
          {label}
        </label>
      </div>

      {closed ? (
        <p className="text-muted-foreground self-center text-sm">Closed — no hours worked</p>
      ) : (
        <div className="grid gap-2">
          {day.ranges.map((range, index) => {
            const problem = rangeProblem(range)
            const shift = `${label}, shift ${index + 1}`

            return (
              <div key={range.key} className="flex flex-wrap items-center gap-2">
                {/* The atom, not a hand-styled `<input>`. Every class the raw
                    version carried — `border-input`, `bg-card`, `h-9`,
                    `rounded-sm`, the `aria-invalid` hook — is already in
                    `components/ui/input.tsx`, and `exception-dialog.tsx` renders
                    the same control through it forty lines away. What is left
                    here is what is actually specific: a tighter gutter and
                    tabular figures, since these sit in a row of six. */}
                <Input
                  type="time"
                  aria-label={`${shift} start`}
                  aria-invalid={Boolean(problem) || overlapping}
                  value={range.start}
                  disabled={disabled}
                  onChange={(event) => onChange(range.key, 'start', event.target.value)}
                  className="w-auto px-2 font-mono"
                />
                <span aria-hidden="true" className="text-muted-foreground">
                  –
                </span>
                <Input
                  type="time"
                  aria-label={`${shift} end`}
                  aria-invalid={Boolean(problem) || overlapping}
                  value={range.end}
                  disabled={disabled}
                  onChange={(event) => onChange(range.key, 'end', event.target.value)}
                  className="w-auto px-2 font-mono"
                />

                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${shift}`}
                  disabled={disabled}
                  onClick={() => onRemove(range.key)}
                >
                  <X aria-hidden="true" />
                </Button>

                {problem ? (
                  <p role="alert" className="text-destructive text-xs">
                    {problem}
                  </p>
                ) : null}
              </div>
            )
          })}

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" disabled={disabled || full} onClick={onAdd}>
              <Plus aria-hidden="true" />
              Add a shift
            </Button>
            {/* The lunch break, named. Somebody looking for "how do I say we
                shut at midday" needs to be told the answer is a second row. */}
            {day.ranges.length === 1 ? (
              <span className="text-muted-foreground text-xs">for a split shift or a break</span>
            ) : null}
          </div>

          {overlapping ? (
            <p role="alert" className="text-foreground text-xs">
              These hours overlap something else in the week. Two ranges cannot claim the same
              minute.
            </p>
          ) : null}
        </div>
      )}
    </li>
  )
}
