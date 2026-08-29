import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { SlotGrid } from '@/features/booking/slot-grid'
import type { SlotDay } from '@/lib/time'

/**
 * The roving tabindex under data that moves.
 *
 * The grid is rendered directly here rather than through the page, because the
 * case that breaks it is a refetch returning a *different* day — a reconnect, or
 * wave 4 invalidating availability after a booking — and a rerender with new
 * props is exactly that event with none of the plumbing.
 */

const TZ = 'Europe/Paris'

function slotAt(parisClock: string) {
  const start = new Date(`2026-08-31T${parisClock}:00+02:00`)
  return {
    start: start.toISOString().replace('.000Z', 'Z'),
    end: new Date(start.getTime() + 30 * 60_000).toISOString().replace('.000Z', 'Z'),
    staffIds: ['4e2ce84b-db0d-4502-b27e-8cb4a978884c'],
  }
}

function oneDay(...clocks: string[]): SlotDay[] {
  return [{ dayKey: '2026-08-31', slots: clocks.map(slotAt) }]
}

function tabStops() {
  return screen.getAllByRole('button').filter((button) => button.tabIndex === 0)
}

describe('a day whose slots change underneath the picker', () => {
  it('keeps its one tab stop when the refetch comes back shorter', () => {
    const { rerender } = render(
      <SlotGrid days={oneDay('09:10', '09:35', '11:00')} timeZone={TZ} onSelect={() => {}} />,
    )

    // Focus the last chip, which is where the arrow keys leave the tab stop.
    screen.getByRole('button', { name: /^11:00/ }).focus()
    expect(tabStops()).toHaveLength(1)

    // Two of the three are gone — booked by somebody else while this page sat
    // open. The section is keyed by its day, so it survives with an index that
    // now points past the end of its own list.
    rerender(<SlotGrid days={oneDay('09:10')} timeZone={TZ} onSelect={() => {}} />)

    // Unclamped, every remaining chip is tabIndex -1 and the day drops out of
    // the tab order entirely.
    expect(tabStops()).toHaveLength(1)
    expect(tabStops()[0]).toHaveAccessibleName(/^09:10/)
  })

  it('still gives a longer day exactly one tab stop', () => {
    const { rerender } = render(
      <SlotGrid days={oneDay('09:10')} timeZone={TZ} onSelect={() => {}} />,
    )
    rerender(
      <SlotGrid days={oneDay('09:10', '09:35', '11:00')} timeZone={TZ} onSelect={() => {}} />,
    )

    expect(tabStops()).toHaveLength(1)
  })
})
