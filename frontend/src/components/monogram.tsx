import { UserRound } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Initials in a circle — the only avatar this product has.
 *
 * Not a photo, and not a gravatar: the API has no avatar field, and deriving one
 * from a hash of somebody's email address would send every user's address to a
 * third party in order to decorate a 24px circle.
 *
 * Two letters at most. Three initials stop being legible at this size before
 * they stop fitting, and a name with no letters in it at all — which
 * `@NotBlank @Size(min = 1)` permits — falls back to a glyph rather than to an
 * empty circle that reads as a failed image.
 *
 * `aria-hidden`, always. A monogram is a second rendering of a name that is
 * already on the row in words, and announcing "C B" before "Camille Bérard" is
 * noise. Every caller shows the name beside it; the one that does not — the
 * overlapping stack on a catalogue row — labels the stack instead.
 */

const SIZES = {
  /** 24px. Row avatars, and the overlapping stacks on the catalogue. */
  sm: 'size-6 text-2xs',
  /** 28px. The account menu's trigger. */
  md: 'size-7 text-sm',
  /** 36px. A roster row, where the person is the subject of the row. */
  lg: 'size-9 text-sm',
} as const

type MonogramSize = keyof typeof SIZES

type MonogramProps = {
  fullName: string
  size?: MonogramSize
  /**
   * A deactivated colleague. Rendered in the muted pair rather than the primary
   * one, so a stack of avatars shows *who cannot perform this* without a legend
   * — which is the fact the catalogue's `bookable: false` turns on.
   */
  muted?: boolean
  className?: string
}

export function Monogram({ fullName, size = 'sm', muted, className }: MonogramProps) {
  const initials = initialsOf(fullName)

  return (
    <span
      aria-hidden="true"
      className={cn(
        'font-display tracking-display inline-flex shrink-0 items-center justify-center rounded-full leading-none',
        muted ? 'bg-muted text-muted-foreground' : 'bg-primary-wash text-primary',
        SIZES[size],
        className,
      )}
    >
      {initials || <UserRound className="size-3.5" />}
    </span>
  )
}

/**
 * `"Amélie Rousseau"` → `"AR"`.
 *
 * Spread into code points rather than indexed with `[0]`, because `"Émile"[0]`
 * is fine and an emoji or a surrogate pair is not — a name field accepts
 * anything a person answers with, and half a code point renders as a
 * replacement character.
 */
function initialsOf(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0] ?? '')
    .join('')
    .toUpperCase()
}
