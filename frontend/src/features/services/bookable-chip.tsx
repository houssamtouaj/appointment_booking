import { Archive, CircleAlert, CircleCheck, UserPlus } from 'lucide-react'
import { Popover } from 'radix-ui'
import { Link } from 'react-router-dom'

import type { Bookability, BookableState } from '@/features/services/bookability'
import { assignableTo } from '@/features/services/bookability'
import type { Lookups } from '@/hooks/use-lookups'
import { cn } from '@/lib/utils'
import type { Service } from '@/types'

/**
 * The row's status chip — three values, and one of them does something.
 *
 * **Not a colour.** The same argument the calendar's tiles make and for the same
 * two reasons: about one man in twelve cannot separate the green from the ochre,
 * and the brief's portfolio screenshots get reproduced in greyscale. So each
 * state carries a glyph, an edge and a word as well as a tint, and any one of the
 * four separates it from the others.
 *
 * **Bookable and Archived are text; Not bookable is a button.** That asymmetry is
 * the point of the component. The other two states are reports; this one is a
 * problem with a cause and a one-click fix, and putting the fix inside the thing
 * that announces the problem is the shortest path from noticing to fixed.
 *
 * A popover and not a `title` tooltip. A tooltip cannot be opened on a
 * touchscreen, cannot be reached by a keyboard, and cannot contain the button
 * that fixes the thing it describes. The reason is *also* in the chip's
 * accessible name, so a screen reader hears it without opening anything.
 */

const CHIP_BASE = [
  'inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5',
  'text-xs font-medium whitespace-nowrap',
].join(' ')

const CHIP_STYLE: Record<BookableState, string> = {
  // Solid edge, tinted fill: the settled, unremarkable state.
  bookable: 'border-success/45 bg-success-wash text-foreground',
  // Dashed edge: something is unfinished. The same device `PENDING` uses on a
  // calendar tile, and for the same reason — the edge is read before the glyph.
  unbookable: 'border-dashed border-danger/60 bg-danger-wash text-foreground',
  // Flat and dimmed, no tint at all: switched off on purpose, still worth
  // seeing, no longer worth reading first.
  archived: 'border-border bg-muted text-muted-foreground',
}

const CHIP_ICON = {
  bookable: CircleCheck,
  unbookable: CircleAlert,
  archived: Archive,
} as const

type BookableChipProps = {
  service: Service
  bookability: Bookability
  lookups: Lookups
  /** Assigns a colleague to this service. The chip's whole reason for existing. */
  onAssign: (staffId: string) => void
  /** True while a PATCH from this chip is in flight. */
  assigning: boolean
}

export function BookableChip({
  service,
  bookability,
  lookups,
  onAssign,
  assigning,
}: BookableChipProps) {
  const Icon = CHIP_ICON[bookability.state]

  if (bookability.state !== 'unbookable') {
    return (
      <span className={cn(CHIP_BASE, CHIP_STYLE[bookability.state])}>
        <Icon className="size-3.5" aria-hidden="true" />
        {bookability.label}
      </span>
    )
  }

  const candidates = assignableTo(service, lookups)

  return (
    <Popover.Root>
      <Popover.Trigger
        className={cn(
          CHIP_BASE,
          CHIP_STYLE.unbookable,
          'hover:border-danger cursor-pointer transition-colors',
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {bookability.label}
        {/* The reason, in the accessible name. A person using a screen reader
            hears "Not bookable. Nobody is assigned…" on arrival rather than
            having to open a panel to find out there was one. */}
        <span className="sr-only">. {bookability.reason} Open to fix it.</span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(
            'bg-popover text-popover-foreground border-border shadow-e2 z-50',
            'w-[min(20rem,calc(100vw-2rem))] rounded-md border p-4',
          )}
        >
          <p className="text-foreground text-sm font-medium">Not bookable</p>
          <p className="text-muted-foreground mt-1 text-xs">{bookability.reason}</p>

          {candidates.length > 0 ? (
            <>
              <p className="text-muted-foreground text-2xs tracking-eyebrow mt-4 mb-2 font-mono uppercase">
                Assign staff
              </p>
              <ul className="-mx-1 grid gap-0.5">
                {candidates.map((person) => (
                  <li key={person.id}>
                    <button
                      type="button"
                      disabled={assigning}
                      onClick={() => onAssign(person.id)}
                      className={cn(
                        'hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm',
                        'disabled:pointer-events-none disabled:opacity-50',
                      )}
                    >
                      <UserPlus className="text-muted-foreground size-3.5" aria-hidden="true" />
                      <span className="truncate">{person.fullName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            // No active colleague left to offer. The fix is on the other screen,
            // and an empty list with no explanation would read as a broken menu.
            <p className="text-muted-foreground mt-4 text-xs">
              Everyone active is already assigned to it.{' '}
              <Link to="/team" className="text-primary underline underline-offset-4">
                Reactivate a colleague
              </Link>{' '}
              or invite someone new.
            </p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
