import { Pencil, RotateCcw, Archive } from 'lucide-react'

import { formatDurationText } from '@/i18n/duration'
import { Monogram } from '@/components/monogram'
import { Button } from '@/components/ui/button'
import { BookableChip } from '@/features/services/bookable-chip'
import { bookabilityOf, performersOf } from '@/features/services/bookability'
import type { Lookups } from '@/hooks/use-lookups'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Service } from '@/types'
import { translate, useTranslation } from '@/i18n'

/**
 * One service, as a row.
 *
 * Everything the wave plan asks a row to carry — name, duration, buffers, total
 * block, price, who performs it, and the status chip — plus the two buttons that
 * act on it. At 375px it becomes three stacked bands; above 640px it is one line
 * with the price and the actions on the right.
 */

type ServiceRowProps = {
  service: Service
  lookups: Lookups
  /** The business's ISO 4217 code. Never `'€'` — a hard-coded symbol is a gate item. */
  currency: string
  onEdit: (service: Service) => void
  onDeactivate: (service: Service) => void
  onReactivate: (service: Service) => void
  onAssign: (service: Service, staffId: string) => void
  /** True while any write against **this** row is in flight. */
  busy: boolean
}

export function ServiceRow({
  service,
  lookups,
  currency,
  onEdit,
  onDeactivate,
  onReactivate,
  onAssign,
  busy,
}: ServiceRowProps) {
  const { t } = useTranslation()
  const bookability = bookabilityOf(service, lookups)
  const performers = performersOf(service, lookups)

  return (
    <li
      className={cn(
        'border-border bg-card rounded-md border px-4 py-3 transition-opacity',
        // Archived rows are quieted rather than hidden — the archive tab is a
        // place people go on purpose, and rows they cannot read are no use
        // there. `opacity` and not a grey text colour, so the chip keeps its own
        // contrast.
        !service.active && 'opacity-75',
        busy && 'opacity-60',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-foreground truncate text-sm font-medium">{service.name}</h2>
            <BookableChip
              service={service}
              bookability={bookability}
              lookups={lookups}
              onAssign={(staffId) => onAssign(service, staffId)}
              assigning={busy}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-xs">{describeTiming(service)}</p>
        </div>

        <Performers performers={performers} />

        <p className="text-foreground shrink-0 text-sm font-medium tabular-nums">
          {formatMoney(service.priceCents, currency)}
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(service)} disabled={busy}>
            <Pencil aria-hidden="true" />
            {t('common.edit')}
            <span className="sr-only"> {service.name}</span>
          </Button>

          {service.active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeactivate(service)}
              disabled={busy}
              // "Deactivate", never "Delete" — a wave decision, and the API
              // agrees: `DELETE` answers 200 with `active: false` because
              // bookings reference services forever (backend D15).
            >
              <Archive aria-hidden="true" />
              {t('common.deactivate')}
              <span className="sr-only"> {service.name}</span>
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onReactivate(service)} disabled={busy}>
              <RotateCcw aria-hidden="true" />
              {t('common.reactivate')}
              <span className="sr-only"> {service.name}</span>
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * `60 min · +5 before / +10 after · blocks 75 min`.
 *
 * The buffer and block segments are **omitted when both buffers are zero**, which
 * is most of a new catalogue. With no buffers the block is the duration, and
 * "60 min · blocks 60 min" is a row saying the same number twice — noise on every
 * line, at the cost of the one line where the numbers differ standing out less.
 */
function describeTiming(service: Service): string {
  const duration = formatDurationText(service.durationMinutes)
  const hasBuffers = service.bufferBeforeMinutes > 0 || service.bufferAfterMinutes > 0
  if (!hasBuffers) return duration

  return [
    duration,
    translate('services.row.buffers', {
      before: service.bufferBeforeMinutes,
      after: service.bufferAfterMinutes,
    }),
    // Read off the response rather than added up here, so the number on screen
    // is the one the availability engine and the database's exclusion constraint
    // use (backend D4).
    translate('services.row.blocks', { minutes: service.totalBlockMinutes }),
  ].join(' · ')
}

/** How many faces fit before the row starts looking like a crowd. */
const AVATARS_SHOWN = 3

/**
 * Who performs it, as an overlapping stack.
 *
 * Deactivated performers are drawn muted, which is what makes a *Not bookable*
 * row legible at a glance: three grey circles is the reason, without opening the
 * chip. The names are in one `sr-only` sentence rather than one per circle,
 * because a screen reader reading "A R, M L, C B" as three separate images is
 * worse than a single "Performed by Amélie Rousseau, Marc Lefèvre".
 */
function Performers({
  performers,
}: {
  performers: readonly { id: string; fullName: string; active: boolean }[]
}) {
  const { t } = useTranslation()
  if (performers.length === 0) {
    return (
      <p className="text-muted-foreground shrink-0 text-xs italic sm:w-28">
        {t('services.row.nobodyAssigned')}
      </p>
    )
  }

  const shown = performers.slice(0, AVATARS_SHOWN)
  const hidden = performers.length - shown.length

  return (
    <div className="flex shrink-0 items-center sm:w-28">
      <span className="sr-only">
        {t('services.row.performedBy', {
          names: performers.map((person) => person.fullName).join(', '),
        })}
      </span>
      <div className="flex items-center -space-x-1.5">
        {shown.map((person) => (
          <Monogram
            key={person.id}
            fullName={person.fullName}
            muted={!person.active}
            // A ring in the card's own colour, so overlapping circles read as
            // separate faces rather than as one blob.
            className="ring-card ring-2"
          />
        ))}
      </div>
      {hidden > 0 ? (
        <span className="text-muted-foreground ml-2 text-xs tabular-nums">+{hidden}</span>
      ) : null}
    </div>
  )
}
