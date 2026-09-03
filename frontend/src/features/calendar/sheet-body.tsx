import { formatDurationText } from '@/i18n/duration'
import { styleOf } from '@/features/calendar/status-style'
import { serviceNameIn, staffNameIn, type Lookups } from '@/hooks/use-lookups'
import { formatMoney } from '@/lib/money'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { BookingDetail } from '@/types'

/**
 * Everything `GET /api/bookings/{id}` knows, arranged so the two time ranges
 * cannot be mistaken for each other.
 *
 * That is the point of this component. A booking has an **appointment** — what
 * the customer turns up for — and a **blocked range**, which is the appointment
 * plus its buffers and is what the calendar actually lost (backend D4). They are
 * different facts, only one of them is on the grid, and a person looking for why
 * a slot is missing needs the second one. So they are two rows with two labels
 * and the buffers are named in minutes between them, rather than one range with
 * a footnote.
 *
 * **The blocked range comes from this payload and is never derived.** The
 * service's *current* buffers are the wrong numbers: a booking snapshots its
 * terms at creation (D14), so a service re-buffered last week would give a
 * derived band that disagrees with the constraint the database is enforcing. The
 * same applies to `priceCents` — the price shown is the one that was agreed, not
 * today's.
 */

export function SheetBody({
  booking,
  lookups,
  timeZone,
  currency,
}: {
  booking: BookingDetail
  lookups: Lookups
  timeZone: string
  currency: string
}) {
  const status = styleOf(booking.status)
  const StatusIcon = status.icon

  const day = dayKeyOf(booking.startsAt, timeZone)
  const appointment = `${clockOf(booking.startsAt, timeZone)} – ${clockOf(booking.endsAt, timeZone)}`
  const blocked = `${clockOf(booking.blockedFrom, timeZone)} – ${clockOf(booking.blockedTo, timeZone)}`
  const buffered = booking.bufferBeforeMinutes > 0 || booking.bufferAfterMinutes > 0

  return (
    <div className="space-y-5">
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-xs border px-2 py-1 text-xs font-medium',
          status.tile,
        )}
      >
        {StatusIcon ? <StatusIcon aria-hidden="true" className="size-3.5" /> : null}
        {status.label}
      </span>

      <Section title="When">
        <Row label="Date">{formatDayHeading(day)}</Row>
        <Row label="Appointment">
          <span className="font-mono">{appointment}</span>
        </Row>
        <Row label="Blocked out">
          <span className="font-mono">{blocked}</span>
          <span className="text-muted-foreground mt-0.5 block text-xs">
            {buffered
              ? `The appointment plus ${describeBuffers(booking)} — this is what the calendar lost, and it is why a nearby slot may be unavailable.`
              : 'This service has no buffers, so the blocked range is the appointment itself.'}
          </span>
        </Row>
      </Section>

      <Section title="What">
        <Row label="Service">{serviceNameIn(lookups, booking.serviceId)}</Row>
        <Row label="With">{staffNameIn(lookups, booking.staffId)}</Row>
      </Section>

      <Section title="Guest">
        <Row label="Name">{booking.guest.name}</Row>
        <Row label="Email">
          <Contact href={`mailto:${booking.guest.email}`} value={booking.guest.email} />
        </Row>
        {booking.guest.phone ? (
          <Row label="Phone">
            <Contact href={`tel:${booking.guest.phone}`} value={booking.guest.phone} />
          </Row>
        ) : null}
        {booking.notes ? (
          <Row label="Notes">
            <span className="whitespace-pre-wrap">{booking.notes}</span>
          </Row>
        ) : null}
      </Section>

      <Section title="Money">
        <Row label="Price">{formatMoney(booking.priceCents, currency)}</Row>
        <Row label="Deposit paid">{formatMoney(booking.depositPaidCents, currency)}</Row>
        <Row label="Outstanding">
          {/* The API derives this rather than the client subtracting, so that
              "price minus deposit" has exactly one definition. */}
          <strong className="font-medium">{formatMoney(booking.outstandingCents, currency)}</strong>
          <span className="text-muted-foreground mt-0.5 block text-xs">
            Still to collect at the appointment.
          </span>
        </Row>
        <Row label="Agreed">
          <span className="text-muted-foreground text-xs">
            The price and buffers above are the ones in force when this booking was made, not
            today’s.
          </span>
        </Row>
      </Section>
    </div>
  )
}

/**
 * A guest's address or number, as something to act on.
 *
 * A link rather than plain text, because the reason somebody opens this panel is
 * almost always to get in touch — and `select-all` beside it, because the other
 * reason is to copy the value into whatever they actually use. Re-typing an
 * address off a screen is how a customer stops receiving their confirmations.
 */
function Contact({ href, value }: { href: string; value: string }) {
  return (
    <a href={href} className="text-primary font-mono text-xs break-all select-all hover:underline">
      {value}
    </a>
  )
}

function describeBuffers(booking: BookingDetail): string {
  const before = booking.bufferBeforeMinutes
  const after = booking.bufferAfterMinutes

  if (before > 0 && after > 0) {
    return `${formatDurationText(before)} before and ${formatDurationText(after)} after`
  }
  if (before > 0) return `${formatDurationText(before)} before`
  return `${formatDurationText(after)} after`
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-muted-foreground text-2xs tracking-eyebrow border-rule mb-2 border-b pb-1 font-mono uppercase">
        {title}
      </h3>
      <dl className="space-y-2">{children}</dl>
    </section>
  )
}

/**
 * A definition list rather than a two-column table. These are labelled facts
 * about one thing, which is what a `<dl>` is for, and it survives being read out
 * as "Blocked out, 13:55 to 15:05" rather than as two unrelated cells.
 */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="text-foreground min-w-0 text-sm">{children}</dd>
    </div>
  )
}
