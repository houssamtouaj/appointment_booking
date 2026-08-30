import { describe, expect, it } from 'vitest'

import { bookingStatusSchema } from '@/api/schemas/booking'
import { STATUS_STYLES } from '@/features/calendar/status-style'
import type { BookingStatus } from '@/types'

/**
 * The greyscale test, as arithmetic rather than as an eye.
 *
 * A wave gate item is that status is legible in a greyscale screenshot, and the
 * brief's portfolio shots are frequently reproduced that way. About one man in
 * twelve has the same problem permanently. Neither reader can be checked by
 * looking at the screen in colour, which is the only way this would otherwise be
 * verified — so the property is asserted directly: **any two statuses differ in
 * at least one signal that is not a hue.**
 *
 * The three signals that survive greyscale are the fill's lightness, the edge's
 * stroke pattern, and the presence and shape of a glyph. A change that leaves
 * two statuses distinguishable only by their colour tokens fails here, at the
 * point the change is made, rather than in a screenshot three waves later.
 */

const ALL: BookingStatus[] = bookingStatusSchema.options

/**
 * The part of a class list that reads in greyscale.
 *
 * Colour tokens are deliberately stripped: `bg-success-wash` and
 * `bg-warning-wash` are two different hues at nearly the same lightness, so
 * counting them as a difference is exactly the mistake this file exists to
 * catch. What is kept is `bg-transparent` versus `bg-muted` versus a wash —
 * which are three genuinely different values — and the border's stroke.
 */
function greyscaleSignals(status: BookingStatus): string[] {
  const style = STATUS_STYLES[status]
  const signals: string[] = []

  if (style.tile.includes('bg-transparent')) signals.push('fill:none')
  else if (style.tile.includes('bg-muted')) signals.push('fill:flat')
  else signals.push('fill:tint')

  if (style.tile.includes('border-dashed')) signals.push('edge:dashed')
  else if (style.tile.includes('border-dotted')) signals.push('edge:dotted')
  else signals.push('edge:solid')

  if (style.tile.includes('line-through')) signals.push('text:struck')
  signals.push(`glyph:${style.icon?.displayName ?? style.icon?.name ?? 'none'}`)

  return signals
}

describe('booking status in greyscale', () => {
  it('gives every pair of statuses a difference that is not a colour', () => {
    for (const a of ALL) {
      for (const b of ALL) {
        if (a >= b) continue
        const left = greyscaleSignals(a)
        const right = greyscaleSignals(b)

        const shared = left.filter((signal) => right.includes(signal))
        expect(
          shared.length,
          `${a} and ${b} are identical in greyscale: ${left.join(', ')}`,
        ).toBeLessThan(left.length)
      }
    }
  })

  it('leaves the confirmed tile unmarked, so the marks mean something', () => {
    // Most of a working calendar is confirmed. An icon on every tile is an icon
    // that carries no information; the unmarked state is what makes the four
    // marked ones read as marks.
    expect(STATUS_STYLES.CONFIRMED.icon).toBeUndefined()
    for (const status of ALL.filter((value) => value !== 'CONFIRMED')) {
      expect(STATUS_STYLES[status].icon, `${status} has no glyph`).toBeDefined()
    }
  })

  it('separates the two statuses most easily confused', () => {
    // Cancelled and no-show are both "the customer is not coming", both hollow,
    // and they are different facts about that customer — one of which counts
    // towards the dashboard's no-show rate. They must not look alike.
    const cancelled = greyscaleSignals('CANCELLED')
    const noShow = greyscaleSignals('NO_SHOW')

    expect(cancelled).toContain('text:struck')
    expect(noShow).not.toContain('text:struck')
    expect(cancelled).toContain('edge:dashed')
    expect(noShow).toContain('edge:dotted')
  })

  it('says what every status means, for the sheet', () => {
    for (const status of ALL) {
      expect(STATUS_STYLES[status].meaning.length, `${status} has no meaning`).toBeGreaterThan(20)
    }
  })
})
