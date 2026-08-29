import { useId, useRef, useState } from 'react'

import {
  PART_OF_DAY_LABEL,
  clockOf,
  formatDayHeading,
  splitByPartOfDay,
  type SlotDay,
} from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Slot } from '@/types'

type SlotGridProps = {
  days: SlotDay[]
  timeZone: string
  /** The chosen slot's `start`, or nothing chosen yet. */
  selectedStart?: string
  onSelect: (slot: Slot) => void
}

/**
 * The screen this wave exists for: a week of real offers, grouped by day.
 *
 * **Volume is the design constraint.** The demo returns 163 slots for one
 * service over one week — 98 across three days is the figure the brief's
 * reviewer will see — so a flat list is unusable and a `<select>` is worse. Days
 * are sections, each split into morning / afternoon / evening, and each slot is
 * a chip small enough that a day's worth is scannable and large enough to hit
 * with a thumb.
 *
 * **Times are rendered exactly as the API returned them.** The engine walks its
 * grid from each opening-hours window rather than from the hour, so starts land
 * on `:05`, `:10` and `:35` — verified on the demo. Nothing here rounds, snaps
 * or bins by quarter-hour; a layout that assumed alignment would silently drop
 * the slots that did not fit its columns.
 *
 * **The keyboard model** is a roving tabindex per day: arrows move within a day,
 * Tab moves to the next day, Enter or Space selects. That is what makes 98 slots
 * navigable — a naive version puts 98 tab stops between the picker and the
 * button below it. Traversal is linear rather than two-dimensional on purpose:
 * the chips wrap, so which slot is "above" another changes between 375px and
 * 1440px, and a grid model would mean the same key did different things at
 * different widths.
 */
export function SlotGrid({ days, timeZone, selectedStart, onSelect }: SlotGridProps) {
  return (
    <div className="space-y-8">
      {days.map((day) => (
        <SlotDaySection
          key={day.dayKey}
          day={day}
          timeZone={timeZone}
          selectedStart={selectedStart}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

function SlotDaySection({
  day,
  timeZone,
  selectedStart,
  onSelect,
}: {
  day: SlotDay
  timeZone: string
  selectedStart?: string
  onSelect: (slot: Slot) => void
}) {
  const headingId = useId()
  const parts = splitByPartOfDay(day.slots, timeZone)
  const heading = formatDayHeading(day.dayKey)

  // The day's slots in the order they are rendered, which is the order the
  // arrow keys walk. Rebuilt per render rather than memoised: it is a flat map
  // over at most a few dozen items, and a stale copy would move focus to the
  // wrong chip after a refetch.
  const ordered = parts.flatMap((part) => part.slots)
  // Position by start, so the buttons can be rendered inside three nested
  // part-of-day maps and still agree on one index each. A counter incremented
  // during render would be the obvious alternative and is a real bug: render
  // can be replayed, and the second pass would start from where the first
  // finished.
  const indexByStart = new Map(ordered.map((slot, position) => [slot.start, position]))
  const selectedIndex = ordered.findIndex((slot) => slot.start === selectedStart)

  /**
   * Which chip is this day's single tab stop. Seeded to the selection when the
   * chosen slot is in this day, so returning to the picker puts focus on the
   * answer rather than back at 09:00.
   */
  const [activeIndex, setActiveIndex] = useState(() => (selectedIndex >= 0 ? selectedIndex : 0))
  /**
   * Clamped every render, because the day's list can shrink underneath it.
   *
   * This section is keyed by `dayKey`, so it survives a refetch — a reconnect,
   * or wave 4 invalidating availability after a booking — and the seeded index
   * can end up past the end of a shorter list. Every chip would then be
   * `tabIndex={-1}` and the whole day would drop out of the tab order, which is
   * the one thing the roving tabindex exists to guarantee.
   */
  const active = Math.min(activeIndex, ordered.length - 1)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // Plain functions, not useCallback: the React Compiler is on for this project
  // and memoises them itself. A hand-written useCallback here reads as an
  // optimisation and is the opposite — the compiler refuses to optimise a
  // component whose manual memoization it cannot prove it preserves, so the
  // whole component falls back to no memoization at all.
  function focusAt(index: number) {
    setActiveIndex(index)
    buttons.current[index]?.focus()
  }

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    const last = ordered.length - 1
    let next: number | null = null

    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(index + 1, last)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(index - 1, 0)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last

    if (next === null) return
    // Only once a key is actually handled: ArrowDown must still scroll the page
    // when focus is on the last slot of the last day.
    event.preventDefault()
    focusAt(next)
  }

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="border-rule text-foreground border-b pb-2 text-sm font-medium">
        {heading}
        <span className="text-muted-foreground ml-2 font-mono text-xs">
          {day.slots.length} {day.slots.length === 1 ? 'time' : 'times'}
        </span>
      </h3>

      <div className="mt-4 space-y-4">
        {parts.map((part) => (
          <div key={part.part}>
            <h4 className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
              {PART_OF_DAY_LABEL[part.part]}
            </h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {part.slots.map((slot) => {
                const slotIndex = indexByStart.get(slot.start) ?? 0
                const selected = slot.start === selectedStart

                return (
                  <button
                    key={slot.start}
                    ref={(element) => {
                      buttons.current[slotIndex] = element
                    }}
                    type="button"
                    // One tab stop per day. Tab therefore moves between days,
                    // which is the half of the model that makes 98 slots
                    // reachable without 98 key presses.
                    tabIndex={slotIndex === active ? 0 : -1}
                    aria-pressed={selected}
                    // The visible label is the time alone; a screen reader
                    // landing here by Tab has no column header to fall back on,
                    // so the name carries the day too.
                    aria-label={`${clockOf(slot.start, timeZone)}, ${heading}`}
                    onKeyDown={(event) => onKeyDown(event, slotIndex)}
                    onFocus={() => setActiveIndex(slotIndex)}
                    onClick={() => onSelect(slot)}
                    className={cn(
                      'rounded-xs border px-3 py-2 font-mono text-sm transition-colors',
                      'min-w-[4.5rem]',
                      selected
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border bg-card text-foreground hover:border-primary hover:bg-primary-wash',
                    )}
                  >
                    {clockOf(slot.start, timeZone)}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
