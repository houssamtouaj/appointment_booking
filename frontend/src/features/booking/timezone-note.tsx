import { Globe } from 'lucide-react'

import { viewerTimeZone, zoneAbbreviation, zoneCity, zonesAgree } from '@/lib/time'

type TimezoneNoteProps = {
  /** The business's zone. Every time on the screen is already in it. */
  timeZone: string
  /** The instant the offsets are compared at — the week being shown, not today. */
  at?: Date
}

/**
 * One banner, once, when the viewer is on a different clock from the business
 * (F8).
 *
 * **Not a per-slot annotation.** Ninety-eight slots each carrying "(Paris time)"
 * is the same sentence ninety-eight times, and it makes the grid unreadable to
 * say something that is true of the whole page.
 *
 * It stays silent when the two zones share an offset. A visitor in Berlin
 * reading a Paris salon is on the same clock to the minute, and a banner
 * announcing a difference that does not exist is how people learn to skip the
 * banner that matters.
 *
 * `status` rather than `alert`: this is context, not an interruption. A screen
 * reader should meet it in reading order.
 */
export function TimezoneNote({ timeZone, at = new Date() }: TimezoneNoteProps) {
  const viewer = viewerTimeZone()
  if (zonesAgree(viewer, timeZone, at)) return null

  return (
    <p
      role="status"
      className="bg-info-wash text-info flex items-center gap-2 rounded-sm px-3 py-2 text-sm"
    >
      <Globe className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Times shown in {zoneCity(timeZone)} time ({zoneAbbreviation(timeZone, at)}).
      </span>
    </p>
  )
}
