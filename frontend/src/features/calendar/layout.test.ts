import { describe, expect, it } from 'vitest'

import { frameOf, layOutSpans, type Placement, type Span } from '@/features/calendar/layout'

/**
 * The four shapes the wave gate names — nested, chained, identical and
 * zero-length — plus the one property that matters more than any of them:
 * **nothing is ever hidden**.
 *
 * Tested here rather than through the grid because every one of these failures
 * looks fine on screen. A tile drawn underneath another tile is not a visual
 * defect a reviewer notices; it is an appointment that has silently left the
 * calendar, and the person it belongs to finds out when the customer arrives.
 */

function span(key: string, start: number, end: number): Span {
  return { key, start, end }
}

/** Placements by key, so an assertion names the booking rather than an index. */
function placed(spans: Span[]): Record<string, Placement> {
  return Object.fromEntries(layOutSpans(spans).map((placement) => [placement.key, placement]))
}

/**
 * The invariant, checked as a property rather than as a case: no two spans that
 * genuinely overlap in time may be given the same column.
 *
 * Every specific test below is an example of this; having it as a function is
 * what makes the examples cheap to add.
 */
function noneCovered(spans: Span[]): void {
  const placements = layOutSpans(spans)
  expect(placements).toHaveLength(spans.length)

  for (const a of placements) {
    for (const b of placements) {
      if (a.key >= b.key) continue
      const overlaps =
        a.start < Math.max(b.end, b.start + 1) && b.start < Math.max(a.end, a.start + 1)
      if (!overlaps) continue
      expect(
        a.column === b.column && a.columns === b.columns,
        `${a.key} and ${b.key} overlap and share column ${a.column}`,
      ).toBe(false)
    }
  }
}

describe('two staff at the same hour', () => {
  it('puts them side by side, each at half width', () => {
    const day = [span('amelie', 600, 660), span('marc', 600, 660)]
    const placements = placed(day)

    expect(placements.amelie?.columns).toBe(2)
    expect(placements.marc?.columns).toBe(2)
    expect(placements.amelie?.column).not.toBe(placements.marc?.column)
    noneCovered(day)
  })

  it('leaves a lone afternoon appointment full width', () => {
    // The reason the cluster and not the day is the unit. Dividing by the day's
    // busiest hour would render this at a third of the column for no reason.
    const day = [
      span('a', 540, 600),
      span('b', 540, 600),
      span('c', 540, 600),
      span('q', 1020, 1080),
    ]

    expect(placed(day).q?.columns).toBe(1)
    expect(placed(day).a?.columns).toBe(3)
  })
})

describe('the shapes the gate names', () => {
  it('nested: an hour with a quarter-hour inside it', () => {
    const day = [span('long', 600, 660), span('short', 615, 630)]
    const placements = placed(day)

    expect(placements.long?.columns).toBe(2)
    // Longest first, so the appointment that constrains the cluster is on the
    // left and the short one sits beside it rather than the other way round.
    expect(placements.long?.column).toBe(0)
    expect(placements.short?.column).toBe(1)
    noneCovered(day)
  })

  it('chained: a run that never needs a third column', () => {
    // A 09:00–10:00, B 09:30–10:30, C 10:00–11:00. A and C do not overlap, so C
    // goes back into A's column. Three columns here would be a first-fit search
    // that forgot to look at freed columns.
    const day = [span('a', 540, 600), span('b', 570, 630), span('c', 600, 660)]
    const placements = placed(day)

    expect(placements.a?.columns).toBe(2)
    expect(placements.a?.column).toBe(0)
    expect(placements.b?.column).toBe(1)
    expect(placements.c?.column).toBe(0)
    noneCovered(day)
  })

  it('identical: four bookings on exactly the same range', () => {
    const day = [span('d', 600, 660), span('c', 600, 660), span('b', 600, 660), span('a', 600, 660)]
    const placements = layOutSpans(day)

    expect(placements.every((placement) => placement.columns === 4)).toBe(true)
    expect(new Set(placements.map((placement) => placement.column)).size).toBe(4)
    noneCovered(day)
  })

  it('identical: keeps the same column across renders, so tiles do not jump', () => {
    // Same three bookings, arriving in a different order — which is what a
    // refetch can genuinely do, since the API orders by (startsAt, id) and these
    // three share a start. Without the key tiebreak the columns shuffle and the
    // grid appears to twitch every time anything invalidates.
    const first = placed([span('a', 600, 660), span('b', 600, 660), span('c', 600, 660)])
    const second = placed([span('c', 600, 660), span('a', 600, 660), span('b', 600, 660)])

    expect(second.a?.column).toBe(first.a?.column)
    expect(second.b?.column).toBe(first.b?.column)
    expect(second.c?.column).toBe(first.c?.column)
  })

  it('zero-length: is given a column of its own rather than hidden underneath', () => {
    // Not a booking that should exist, and not one the API forbids. Under plain
    // half-open intervals an empty range overlaps nothing, so it would share a
    // column with the hour it sits inside and never be seen or clicked.
    const day = [span('real', 600, 660), span('degenerate', 600, 600)]
    const placements = placed(day)

    expect(placements.degenerate?.columns).toBe(2)
    expect(placements.degenerate?.column).not.toBe(placements.real?.column)
    noneCovered(day)
  })

  it('zero-length: two at the same instant still get a column each', () => {
    const day = [span('x', 600, 600), span('y', 600, 600)]
    expect(placed(day).x?.columns).toBe(2)
    noneCovered(day)
  })
})

describe('back-to-back appointments', () => {
  it('are not treated as an overlap', () => {
    // Half-open intervals. The most common arrangement on a working calendar,
    // and treating it as a collision would halve nearly every tile on screen.
    const day = [span('a', 540, 600), span('b', 600, 660), span('c', 660, 720)]
    const placements = placed(day)

    expect(placements.a?.columns).toBe(1)
    expect(placements.b?.columns).toBe(1)
    expect(placements.c?.columns).toBe(1)
  })
})

describe('a booking that started yesterday', () => {
  it('is placed from its negative start rather than dropped', () => {
    // `minutesIntoDay` is signed on purpose: a booking straddling midnight is
    // real, and the layout must not be the thing that decides it did not happen.
    const day = [span('overnight', -30, 60), span('morning', 30, 90)]
    const placements = placed(day)

    expect(placements.overnight?.start).toBe(-30)
    expect(placements.overnight?.columns).toBe(2)
    noneCovered(day)
  })
})

describe('frameOf', () => {
  it('turns a column of n into a left and a width that tile exactly', () => {
    const placements = layOutSpans([span('a', 600, 660), span('b', 600, 660), span('c', 600, 660)])
    const frames = placements.map(frameOf)

    expect(frames.map((frame) => frame.width)).toEqual([
      `${100 / 3}%`,
      `${100 / 3}%`,
      `${100 / 3}%`,
    ])
    expect(new Set(frames.map((frame) => frame.left)).size).toBe(3)
  })

  it('gives a lone booking the whole column', () => {
    const [only] = layOutSpans([span('a', 600, 660)])
    expect(only && frameOf(only)).toEqual({ left: '0%', width: '100%' })
  })
})

describe('an empty day', () => {
  it('lays out nothing without complaint', () => {
    expect(layOutSpans([])).toEqual([])
  })
})
