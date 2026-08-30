import { describe, expect, it } from 'vitest'

import { cn } from '@/lib/utils'

/**
 * The class merger, and the one thing it gets wrong out of the box.
 *
 * `tailwind-merge` files a `text-*` utility as a font size or a text colour by
 * looking at the suffix, and a suffix that is not a t-shirt size is assumed to be
 * a colour. Our display scale is named after its role rather than its size, so
 * every one of those was being treated as a colour and deleted by the real
 * colour beside it.
 *
 * The failure is invisible in the markup — the className in the source is
 * correct, and only the rendered font size is wrong — which is exactly why it is
 * worth a test rather than a comment.
 */
describe('cn', () => {
  it('keeps a display size alongside a text colour', () => {
    const merged = cn('font-display text-display-md text-foreground')

    expect(merged).toContain('text-display-md')
    expect(merged).toContain('text-foreground')
  })

  it.each(['display-sm', 'display-md', 'display-lg'])('knows text-%s is a size', (size) => {
    expect(cn(`text-${size} text-muted-foreground`)).toContain(`text-${size}`)
  })

  it('still lets one size win over another', () => {
    // The behaviour being extended, not replaced: two font sizes are still a
    // conflict, and the last one still wins.
    expect(cn('text-display-sm text-display-md')).toBe('text-display-md')
    expect(cn('text-sm text-display-md')).toBe('text-display-md')
  })

  it('still lets one colour win over another', () => {
    expect(cn('text-muted-foreground text-foreground')).toBe('text-foreground')
  })

  it('keeps an elevation alongside a shadow colour', () => {
    // `e2` is not a t-shirt size either, so out of the box this is filed as a
    // shadow *colour* and deleted by the real one beside it — the identical
    // failure the display sizes had, one property along.
    expect(cn('shadow-e2 shadow-primary')).toContain('shadow-e2')
    expect(cn('shadow-md shadow-e2')).toBe('shadow-e2')
  })

  it.each([
    ['tracking-wide tracking-display', 'tracking-display'],
    ['max-w-md max-w-copy', 'max-w-copy'],
  ])('resolves %s rather than emitting both', (input, expected) => {
    // These fail the other way round: no group at all, so both survive and the
    // stylesheet's order decides instead of the last class.
    expect(cn(input)).toBe(expected)
  })
})
