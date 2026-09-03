import { Check, CircleSlash, Hourglass, UserX, type LucideIcon } from 'lucide-react'

import type { BookingStatus } from '@/types'
import { currentLocale, translate, type TKey } from '@/i18n'

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
  label: TKey
  /** The tile's own classes: fill, edge and text treatment. */
  tile: string
  /** The 3px spine down the left of a tile, which is the fastest of the signals. */
  spine: string
  /** Absent for `CONFIRMED` — see the note above. */
  icon?: LucideIcon
  /** One line, for the sheet: what this status means about the appointment. */
  meaning: TKey
}

export const STATUS_STYLES: Record<BookingStatus, StatusStyle> = {
  CONFIRMED: {
    label: 'calendar.status.confirmed',
    tile: 'border-success/45 bg-success-wash text-foreground',
    spine: 'bg-success',
    meaning: 'calendar.status.confirmedMeaning',
  },
  PENDING: {
    label: 'calendar.status.pending',
    // Dashed: the booking is not settled, and the edge says so before the icon
    // is read. It still holds the slot, so the fill is tinted like a confirmed
    // one rather than hollow.
    tile: 'border-dashed border-warning/60 bg-warning-wash text-foreground',
    spine: 'bg-warning',
    icon: Hourglass,
    meaning: 'calendar.status.pendingMeaning',
  },
  COMPLETED: {
    label: 'calendar.status.completed',
    // Flat grey and dimmed: done, still worth seeing, no longer worth reading
    // first. This is the only status whose text is quieted without being struck.
    tile: 'border-border bg-muted text-muted-foreground',
    spine: 'bg-muted-foreground/50',
    icon: Check,
    meaning: 'calendar.status.completedMeaning',
  },
  CANCELLED: {
    // Hollow and struck through. The slot is back on the market, and the tile
    // should read as a line drawn through an entry in the book rather than as
    // an appointment.
    label: 'calendar.status.cancelled',
    tile: 'border-dashed border-border bg-transparent text-muted-foreground line-through',
    spine: 'bg-border',
    icon: CircleSlash,
    meaning: 'calendar.status.cancelledMeaning',
  },
  NO_SHOW: {
    // Outlined and hollow, but not struck: the appointment was not cancelled,
    // it was missed, and those are different facts about the customer. A dotted
    // edge separates it from `CANCELLED` in greyscale.
    label: 'calendar.status.noShow',
    tile: 'border-dotted border-danger/70 bg-transparent text-foreground',
    spine: 'bg-danger',
    icon: UserX,
    meaning: 'calendar.status.noShowMeaning',
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
  // Lower-cased for English, where a status word mid-sentence is lower case.
  // French capitalises the same words no more than English does, and `Intl` has
  // no opinion about it — `toLocaleLowerCase` with the reader's locale is still
  // the right call, because Turkish dotted I is a real case difference and this
  // costs nothing.
  if (known) return translate(known.label).toLocaleLowerCase(currentLocale())
  // A status this bundle predates. The wire value, made readable, and not
  // translated because there is nothing to translate it to.
  return status.toLowerCase().replace(/_/g, ' ')
}
