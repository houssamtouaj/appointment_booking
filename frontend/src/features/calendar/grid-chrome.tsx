import { HOUR_REM, remOf, type GridScale } from '@/features/calendar/grid-scale'
import { clockOf, minutesIntoDay, type DayKey } from '@/lib/time'

/**
 * The ruled page itself — gutter, rules and the now line.
 *
 * Everything on the grid that is not an appointment. Split from `time-grid.tsx`
 * because it is decoration in the strict sense: none of it is interactive, none
 * of it is in the accessibility tree, and all three pieces are pure functions of
 * the scale. Keeping them here leaves that file about the one thing it has to
 * get right, which is where each appointment goes.
 */

/**
 * The hour column. Mono, right-aligned, and the labels sit *against* their line
 * rather than centred between two — the same convention as the ruled paper the
 * design is after, where the writing sits on the rule.
 */
export function TimeGutter({ scale }: { scale: GridScale }) {
  return (
    <div className="bg-card relative" style={{ height: remOf(scale.minutes) }}>
      {scale.marks.map((mark, index) => (
        <span
          key={`${mark.minutes}-${mark.label}`}
          className="text-muted-foreground text-grid absolute right-2 -translate-y-1/2 font-mono"
          style={{ top: remOf(mark.minutes) }}
        >
          {/* Midnight is the top edge and its label would be clipped in half.
              Every other hour is labelled, including a repeat on the night the
              clocks go back — which is true, and the reason `hourMarks` walks
              elapsed time rather than counting to 23. */}
          {index === 0 ? null : mark.label}
        </span>
      ))}
    </div>
  )
}

/**
 * The ruling: a hairline every hour, a fainter one at the policy's granularity.
 *
 * Drawn with repeating gradients rather than as elements, because at 15-minute
 * ruling a week is 672 divs that exist only to be one pixel tall.
 */
export function Rules({ scale }: { scale: GridScale }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{
        backgroundImage: [
          `repeating-linear-gradient(to bottom, var(--rule) 0 1px, transparent 1px ${HOUR_REM}rem)`,
          `repeating-linear-gradient(to bottom, color-mix(in oklab, var(--rule) 45%, transparent) 0 1px, transparent 1px ${remOf(scale.rowMinutes)})`,
        ].join(','),
      }}
    />
  )
}

/**
 * Where we are now, on today's column only.
 *
 * Positioned by elapsed minutes like everything else, so it is in the right
 * place on a DST day too. It is not a live clock: it re-renders when the screen
 * does, which on a query that refetches on window focus is often enough for a
 * line whose job is "roughly here" — and a timer ticking every minute on a
 * screen left open all day is a re-render of forty tiles to move a line by half
 * a pixel.
 */
export function NowLine({
  dayKey,
  timeZone,
  now,
}: {
  dayKey: DayKey
  timeZone: string
  now: Date
}) {
  const minutes = minutesIntoDay(now, dayKey, timeZone)
  if (minutes < 0) return null

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top: remOf(minutes) }}
    >
      <span className="bg-primary size-1.5 shrink-0 rounded-full" />
      <span className="bg-primary h-px flex-1" />
      <span className="sr-only">Now, {clockOf(now, timeZone)}</span>
    </div>
  )
}
