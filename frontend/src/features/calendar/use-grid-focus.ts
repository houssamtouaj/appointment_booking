import { useRef, useState } from 'react'

import type { BookingSummary } from '@/types'

/**
 * Keyboard navigation for the grid — the cost of building it by hand (F9).
 *
 * FullCalendar was rejected for this wave because the feature it exists for,
 * drag-to-reschedule, has no endpoint to call. What it also does is ship a
 * keyboard model, and that half is now ours to write. This is it, and it is a
 * line item rather than an afterthought.
 *
 * **One tab stop for the whole grid.** A week can hold sixty appointments, and
 * sixty tab stops between the view switcher and the page below is not a
 * calendar, it is a wall. Tab lands on one tile, arrows move from it, Tab leaves
 * — the roving-tabindex pattern the slot picker already uses in wave 3, extended
 * to two dimensions because this grid genuinely has two.
 *
 * The bindings the wave plan specifies, plus one it does not:
 *
 * | Key                 | Moves                                        |
 * |---------------------|----------------------------------------------|
 * | Up / Down           | Between appointments **within** a day         |
 * | Left / Right        | Between days, landing at the nearest time     |
 * | PageUp / PageDown   | Between days, likewise                        |
 * | Home / End          | First / last appointment of the day           |
 *
 * Left and Right are the addition. The plan assigns days to `PageUp`/`PageDown`
 * alone, and those are kept — but on a seven-column grid the horizontal arrows
 * are the keys a person actually reaches for, and leaving them inert to satisfy
 * a table would be following the letter of the plan against its point. Vertical
 * arrows stay within the day because a day column *is* a vertical list, which is
 * the mapping the plan asks for.
 */

export type GridPosition = { column: number; index: number }

/** What the hook needs of a column: an identity and its bookings, already sorted. */
export type FocusColumn = { key: string; bookings: readonly BookingSummary[] }

export type GridFocus = {
  /** 0 for the single tab stop, -1 for everything else. */
  tabIndexAt: (position: GridPosition) => number
  onKeyDown: (event: React.KeyboardEvent, position: GridPosition) => void
  onFocus: (position: GridPosition) => void
  register: (id: string) => (element: HTMLButtonElement | null) => void
}

export function useGridFocus(columns: readonly FocusColumn[]): GridFocus {
  const [active, setActive] = useState<GridPosition>({ column: 0, index: 0 })
  const elements = useRef(new Map<string, HTMLButtonElement | null>())

  /**
   * The tab stop, resolved every render rather than stored.
   *
   * The grid's contents change underneath it constantly — a week is paged, a
   * filter is applied, a refetch returns fewer rows — and a stored index can end
   * up past the end of a shorter column. Every tile would then be `tabIndex={-1}`
   * and the whole grid would drop out of the tab order, which is the one thing
   * the roving pattern exists to guarantee. So the saved position is a
   * *preference*, and this is the nearest real place to honour it.
   */
  const stop = resolveStop(columns, active)

  function focusAt(next: GridPosition) {
    const id = columns[next.column]?.bookings[next.index]?.id
    if (!id) return
    setActive(next)
    elements.current.get(id)?.focus()
  }

  // Plain functions, not `useCallback`: the React Compiler is on for this
  // project and memoises them itself. A hand-written `useCallback` here reads as
  // an optimisation and is the opposite — the compiler declines to optimise a
  // component whose manual memoization it cannot prove it preserves.
  function onKeyDown(event: React.KeyboardEvent, position: GridPosition) {
    const column = columns[position.column]
    if (!column) return

    const last = column.bookings.length - 1
    let next: GridPosition | null = null

    switch (event.key) {
      case 'ArrowDown':
        next = { ...position, index: Math.min(position.index + 1, last) }
        break
      case 'ArrowUp':
        next = { ...position, index: Math.max(position.index - 1, 0) }
        break
      case 'Home':
        next = { ...position, index: 0 }
        break
      case 'End':
        next = { ...position, index: last }
        break
      case 'ArrowRight':
      case 'PageDown':
        next = acrossDays(columns, position, 1)
        break
      case 'ArrowLeft':
      case 'PageUp':
        next = acrossDays(columns, position, -1)
        break
      default:
        return
    }

    if (!next) return
    // Only once a key is actually handled: ArrowDown must still scroll the grid
    // when focus is already on the last appointment of a day, and PageDown must
    // still page the document when there is no next day with anything in it.
    event.preventDefault()
    focusAt(next)
  }

  return {
    tabIndexAt: (position) =>
      position.column === stop.column && position.index === stop.index ? 0 : -1,
    onKeyDown,
    onFocus: (position) => setActive(position),
    register: (id) => (element) => {
      if (element) elements.current.set(id, element)
      else elements.current.delete(id)
    },
  }
}

/**
 * The saved position, clamped into a column that actually has something in it.
 *
 * Prefers the saved column, then searches outwards. Searching rather than
 * falling back to the first column is what keeps focus roughly where the person
 * left it when a filter empties the day they were on — jumping to Monday because
 * Thursday went quiet loses their place for no reason.
 */
function resolveStop(columns: readonly FocusColumn[], active: GridPosition): GridPosition {
  const filled = columns.findIndex((column) => column.bookings.length > 0)
  if (filled === -1) return { column: 0, index: 0 }

  const preferred = columns[active.column]
  if (preferred && preferred.bookings.length > 0) {
    return { column: active.column, index: Math.min(active.index, preferred.bookings.length - 1) }
  }

  const nearest = nextFilled(columns, active.column, 1) ?? nextFilled(columns, active.column, -1)
  return { column: nearest ?? filled, index: 0 }
}

function nextFilled(
  columns: readonly FocusColumn[],
  from: number,
  step: number,
): number | undefined {
  for (let at = from + step; at >= 0 && at < columns.length; at += step) {
    if ((columns[at]?.bookings.length ?? 0) > 0) return at
  }
  return undefined
}

/**
 * The next day in that direction that has anything on it, landing on the
 * appointment nearest in time to the one being left.
 *
 * Nearest-in-time and not "the same index", which is the version that feels
 * broken: index 3 on a busy Monday is mid-afternoon and index 3 on a quiet
 * Tuesday is the end of the day, so paging sideways would wander down the
 * calendar. Matching by start keeps a horizontal walk horizontal.
 *
 * Empty days are skipped rather than landed on. There is nothing to focus on an
 * empty day, and stopping there would strand the keyboard.
 */
function acrossDays(
  columns: readonly FocusColumn[],
  position: GridPosition,
  step: number,
): GridPosition | null {
  const target = nextFilled(columns, position.column, step)
  if (target === undefined) return null

  const leaving = columns[position.column]?.bookings[position.index]
  const arriving = columns[target]?.bookings ?? []
  if (!leaving) return { column: target, index: 0 }

  const at = Date.parse(leaving.startsAt)
  let nearest = 0
  let best = Number.POSITIVE_INFINITY

  arriving.forEach((booking, index) => {
    // Compared as clock-of-day rather than as instants: the appointments being
    // compared are on different dates, so the raw difference is dominated by how
    // many days apart they are and every walk would land on index 0.
    const distance = Math.abs(minutesOfDay(Date.parse(booking.startsAt)) - minutesOfDay(at))
    if (distance < best) {
      best = distance
      nearest = index
    }
  })

  return { column: target, index: nearest }
}

const DAY_MS = 86_400_000

/**
 * Minutes past UTC midnight. Good enough for "which of these is nearest in the
 * day", which is all it is for — the answer only has to rank, and every
 * appointment being ranked is in the same zone.
 */
function minutesOfDay(at: number): number {
  return (((at % DAY_MS) + DAY_MS) % DAY_MS) / 60_000
}
