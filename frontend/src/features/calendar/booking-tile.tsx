import type { TileGeometry } from '@/features/calendar/grid-scale'
import { styleOf } from '@/features/calendar/status-style'
import { serviceNameIn, staffNameIn, type Lookups } from '@/hooks/use-lookups'
import { clockOf } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingSummary } from '@/types'

/**
 * One appointment on the grid.
 *
 * A `<button>`, not a div with a click handler, and that single choice pays for
 * most of what the wave's accessibility gate asks: it is focusable, it is in the
 * tab order, Enter and Space activate it without any code here, and it is
 * announced as something operable rather than as text that happens to move when
 * clicked.
 *
 * **Its accessible name is the whole appointment**, because a visual grid says
 * *when* by position and a screen reader gets none of that. So the name carries
 * the guest, the service, the colleague, both ends of the time and the status —
 * "Yasmine Haddad, Coupe classique with Amélie Rousseau, 14:00 to 15:00,
 * confirmed" — while the visible tile shows however much of that will fit.
 *
 * **What it deliberately does not show is the blocked range.** A booking's
 * buffers are on `GET /api/bookings/{id}` and nowhere else, and deriving them
 * from the service's current buffers would be wrong: bookings snapshot their
 * terms at creation (backend D14), so a re-buffered service makes a derived band
 * disagree with the constraint the database is enforcing. The appointment goes
 * on the grid; the blocked range goes in the sheet, named.
 */

type BookingTileProps = {
  booking: BookingSummary
  lookups: Lookups
  timeZone: string
  geometry: TileGeometry
  /** Its slot in the grid's single tab stop, per the roving model in `week-grid`. */
  tabIndex: number
  /** True while its sheet is open, which is a selection rather than a hover. */
  selected: boolean
  onOpen: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
  onFocus: () => void
  /**
   * An ordinary prop, on React 19. `useGridFocus` collects these to move focus
   * between tiles; this was the codebase's only `forwardRef`, which on 19 buys a
   * wrapper, a second type parameter and a named inner function in exchange for
   * a value that can simply be destructured beside `booking`.
   */
  ref?: React.Ref<HTMLButtonElement>
}

/**
 * How much a tile can say, from how tall it is.
 *
 * Worked out in minutes rather than measured, because the scale is fixed and
 * minutes are what the caller already has — measuring would mean a layout pass
 * per tile on a screen that draws forty of them. At `HOUR_REM` a minute is
 * about 0.93px, so the arithmetic behind the two numbers is:
 *
 * - **45 min ≈ 42px.** Minus the tile's own padding that is 38px, which is what
 *   three lines of 11–12px type at `leading-tight` need. Time, guest, service.
 * - **25 min ≈ 23px**, or 19px of content — one line, comfortably. So a
 *   half-hour appointment sets the clock and the name *side by side* rather than
 *   stacked. Stacking them needs 25px and had 24px, so the name was clipped in
 *   half: the commonest appointment length in the demo, showing the one thing a
 *   person is looking for cut off at the ankles.
 * - **Below that**, the clock alone. A ten-minute tile is 9px tall and any name
 *   in it would be a smear.
 */
const THREE_LINE_MINUTES = 45
const INLINE_MINUTES = 25

export function BookingTile({
  booking,
  lookups,
  timeZone,
  geometry,
  tabIndex,
  selected,
  onOpen,
  onKeyDown,
  onFocus,
  ref,
}: BookingTileProps) {
  const style = styleOf(booking.status)
  const Icon = style.icon

  const from = clockOf(booking.startsAt, timeZone)
  const to = clockOf(booking.endsAt, timeZone)
  const service = serviceNameIn(lookups, booking.serviceId)
  const staff = staffNameIn(lookups, booking.staffId)

  const minutes = (Date.parse(booking.endsAt) - Date.parse(booking.startsAt)) / 60_000
  const room =
    minutes >= THREE_LINE_MINUTES ? 'full' : minutes >= INLINE_MINUTES ? 'inline' : 'clock'

  return (
    <button
      ref={ref}
      type="button"
      // The handle the sheet focuses on its way out — see `booking-sheet.tsx`.
      data-booking-id={booking.id}
      tabIndex={tabIndex}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      // The tile is a control that opens a panel describing itself, so it is
      // named by what it opens rather than by a separate "View booking" label
      // that would be read forty times identically.
      aria-label={`${booking.guestName}, ${service} with ${staff}, ${from} to ${to}, ${style.label.toLowerCase()}`}
      aria-current={selected ? 'true' : undefined}
      style={geometry}
      className={cn(
        'absolute overflow-hidden rounded-xs border pr-1.5 pl-2 text-left',
        // `min-h-0` and the padding above are why a 15-minute booking still has
        // a hit area: the tile is as tall as its minutes and no taller, and the
        // text inside it clips rather than pushing it open.
        'flex flex-col justify-start gap-px py-0.5',
        'transition-colors hover:brightness-[0.97]',
        style.tile,
        selected && 'ring-primary ring-2 ring-offset-1',
      )}
    >
      {/* The spine. The fastest of the four status signals to read — it is a
          block of colour at a fixed position, so a full column of tiles can be
          scanned without reading any of them. */}
      <span
        aria-hidden="true"
        className={cn('absolute inset-y-0 left-0 w-[3px] rounded-l-xs', style.spine)}
      />

      <span className="flex min-w-0 items-center gap-1 leading-tight">
        {Icon ? <Icon aria-hidden="true" className="size-3 shrink-0" /> : null}
        <span className="text-grid shrink-0 font-mono">{from}</span>
        {/* Beside the clock rather than under it on a half-hour tile — the two
            stacked need one pixel more than such a tile has, and what gets cut
            is the name. */}
        {room === 'inline' ? (
          <span className="text-grid truncate font-medium">{booking.guestName}</span>
        ) : null}
      </span>

      {room === 'full' ? (
        <>
          <span className="truncate text-xs leading-tight font-medium">{booking.guestName}</span>
          <span className="text-grid truncate leading-tight opacity-80">{service}</span>
        </>
      ) : null}
    </button>
  )
}
