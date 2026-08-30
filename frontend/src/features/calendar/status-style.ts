import { Check, CircleSlash, Hourglass, UserX, type LucideIcon } from 'lucide-react'

import type { BookingStatus } from '@/types'

/**
 * What each status looks like, and why none of it is only a colour.
 *
 * **Colour alone fails twice over**, and both failures are in this wave's gate:
 * about one man in twelve cannot separate the green from the ochre, and the
 * brief asks for portfolio screenshots that are frequently reproduced in
 * greyscale. So every status is carried by *four* signals at once, and any one
 * of them is enough to tell two tiles apart:
 *
 * | Status      | Fill        | Edge   | Glyph        | Text        |
 * |-------------|-------------|--------|--------------|-------------|
 * | `CONFIRMED` | tinted      | solid  | none         | normal      |
 * | `PENDING`   | tinted      | dashed | hourglass    | normal      |
 * | `COMPLETED` | flat grey   | solid  | check        | dimmed      |
 * | `CANCELLED` | none        | dashed | slash        | struck out  |
 * | `NO_SHOW`   | none        | dotted | person-gone  | normal      |
 *
 * Read down the *Fill* column and the three groups separate by lightness alone,
 * which is what survives a screenshot. Read down *Edge* and *Glyph* and the
 * pairs inside each group separate too. The colours are still there and still
 * doing the fast work for the people who can use them; they are simply not
 * carrying the message on their own.
 *
 * `CONFIRMED` is the one with no glyph on purpose. It is most of a working
 * calendar, and an icon on every tile is an icon that means nothing — the
 * unmarked state is what makes the marked ones read as marks.
 */

export type StatusStyle = {
  /** Sentence case, for prose and for a booking's accessible name. */
  label: string
  /** The tile's own classes: fill, edge and text treatment. */
  tile: string
  /** The 3px spine down the left of a tile, which is the fastest of the signals. */
  spine: string
  /** Absent for `CONFIRMED` — see the note above. */
  icon?: LucideIcon
  /** One line, for the sheet: what this status means about the appointment. */
  meaning: string
}

export const STATUS_STYLES: Record<BookingStatus, StatusStyle> = {
  CONFIRMED: {
    label: 'Confirmed',
    tile: 'border-success/45 bg-success-wash text-foreground',
    spine: 'bg-success',
    meaning: 'Booked and paid for as far as it needs to be. It holds its slot.',
  },
  PENDING: {
    label: 'Awaiting deposit',
    // Dashed: the booking is not settled, and the edge says so before the icon
    // is read. It still holds the slot, so the fill is tinted like a confirmed
    // one rather than hollow.
    tile: 'border-dashed border-warning/60 bg-warning-wash text-foreground',
    spine: 'bg-warning',
    icon: Hourglass,
    meaning: 'A deposit is in flight. It holds its slot until the hold expires.',
  },
  COMPLETED: {
    label: 'Completed',
    // Flat grey and dimmed: done, still worth seeing, no longer worth reading
    // first. This is the only status whose text is quieted without being struck.
    tile: 'border-border bg-muted text-muted-foreground',
    spine: 'bg-muted-foreground/50',
    icon: Check,
    meaning: 'The appointment happened. It counts towards revenue earned.',
  },
  CANCELLED: {
    // Hollow and struck through. The slot is back on the market, and the tile
    // should read as a line drawn through an entry in the book rather than as
    // an appointment.
    label: 'Cancelled',
    tile: 'border-dashed border-border bg-transparent text-muted-foreground line-through',
    spine: 'bg-border',
    icon: CircleSlash,
    meaning: 'Cancelled. The slot went back to the calendar immediately.',
  },
  NO_SHOW: {
    // Outlined and hollow, but not struck: the appointment was not cancelled,
    // it was missed, and those are different facts about the customer. A dotted
    // edge separates it from `CANCELLED` in greyscale.
    label: 'No-show',
    tile: 'border-dotted border-danger/70 bg-transparent text-foreground',
    spine: 'bg-danger',
    icon: UserX,
    meaning: 'The customer did not arrive. It counts towards the no-show rate.',
  },
}

export function styleOf(status: BookingStatus): StatusStyle {
  return STATUS_STYLES[status]
}

/**
 * `"confirmed"` — for the middle of a sentence, and for an accessible name.
 *
 * Takes a bare string rather than a `BookingStatus`, and falls back to the value
 * it was given. Its one hostile caller is the copy for a `409` refusal, which
 * reads `from` and `to` off an error body that **has no published schema** (see
 * `schemas/registry.ts`) — so a status this client has never heard of is a thing
 * that can genuinely arrive here. Indexing it into the table unguarded would
 * throw inside the error handler, turning a refusal the screen could have
 * explained into an unhandled exception with no error boundary above it.
 */
export function statusWord(status: string): string {
  const known = STATUS_STYLES[status as BookingStatus]
  return known ? known.label.toLowerCase() : status.toLowerCase().replace(/_/g, ' ')
}
