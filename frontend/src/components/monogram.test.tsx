import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { initialsOf } from '@/components/initials'
import { Monogram } from '@/components/monogram'

/**
 * `initialsOf` is asserted directly and the component through the DOM, because
 * the two have different failure modes: the function's is a name nobody
 * anticipated, and the component's is announcing a monogram a screen reader
 * should never hear.
 */

describe('initialsOf', () => {
  it('takes the first two words', () => {
    expect(initialsOf('Amélie Rousseau')).toBe('AR')
  })

  it('ignores everything past the second word', () => {
    expect(initialsOf('Jean Luc Picard de la Mancha')).toBe('JL')
  })

  it('survives the whitespace a form actually receives', () => {
    expect(initialsOf('  Camille   Bérard  ')).toBe('CB')
    expect(initialsOf('Solo')).toBe('S')
  })

  it('takes whole code points, not the first UTF-16 unit', () => {
    // The reason the implementation spreads rather than indexing. `'𝒜lice'[0]`
    // is half a surrogate pair and renders as a replacement character.
    expect(initialsOf('𝒜lice Zhang')).toBe('𝒜Z')
    expect(initialsOf('🌊 Ocean')).toBe('🌊O')
  })

  it('returns nothing for a name with no letters, rather than a stray glyph', () => {
    // `@NotBlank @Size(min = 1)` permits this, and the component answers it with
    // a fallback icon.
    expect(initialsOf('   ')).toBe('')
    expect(initialsOf('')).toBe('')
  })
})

describe('the monogram', () => {
  it('renders the initials and hides them from a screen reader', () => {
    render(<Monogram fullName="Camille Bérard" />)

    const badge = screen.getByText('CB')
    expect(badge).toBeInTheDocument()
    // The name is already on the row in words; "C B" before it is noise.
    expect(badge).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back to a glyph when the name yields no initials', () => {
    render(<Monogram fullName="   " />)

    // An empty circle reads as a failed image, so something has to be in there.
    // The one DOM query in this file, and the component's own `aria-hidden` is
    // why: a decorative icon inside a hidden span has no accessible handle, and
    // the alternative is asserting nothing about the fallback at all.
    expect(screen.queryByText(/\S/)).not.toBeInTheDocument()
    expect(document.querySelector('svg')).not.toBeNull()
  })

  it('renders a deactivated colleague in the muted pair', () => {
    const { rerender } = render(<Monogram fullName="Ana Silva" muted />)
    expect(screen.getByText('AS')).toHaveClass('bg-muted')

    rerender(<Monogram fullName="Ana Silva" />)
    expect(screen.getByText('AS')).toHaveClass('bg-primary-wash')
  })

  it('takes its geometry from the size token, not from the caller', () => {
    const { rerender } = render(<Monogram fullName="Ana Silva" size="sm" />)
    expect(screen.getByText('AS')).toHaveClass('size-6')

    rerender(<Monogram fullName="Ana Silva" size="lg" />)
    expect(screen.getByText('AS')).toHaveClass('size-9')
  })
})
