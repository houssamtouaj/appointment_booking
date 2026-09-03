import { Link } from 'react-router-dom'

import { formatDurationText } from '@/i18n/duration'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { PublicService } from '@/types'

type ServiceCardProps = {
  service: PublicService
  /** The business's currency. Never assumed, never hard-coded to €. */
  currency: string
  /** Where picking this service goes. */
  to: string
  selected?: boolean
  className?: string
}

/**
 * One service, as a card that is entirely a link.
 *
 * The whole card is the target rather than a "Book" button in its corner: this
 * is the first thing a customer touches on a phone, and a 240px target beats a
 * 64px one. It also means there is exactly one tab stop per service instead of
 * two, which is what keeps the keyboard path from the landing page to a slot
 * short enough to demonstrate.
 *
 * Price and duration are set in the mono face. They are the two numbers a person
 * compares across six cards, and comparing a column only works when the digits
 * line up.
 */
export function ServiceCard({ service, currency, to, selected, className }: ServiceCardProps) {
  return (
    <Link
      to={to}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'group border-border bg-card relative flex flex-col rounded-md border p-5',
        'transition-colors',
        selected ? 'border-primary bg-primary-wash' : 'hover:border-input hover:bg-accent',
        className,
      )}
    >
      {/* The left margin rule, the same device the page header uses. It marks
          where the writing starts. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-5 bottom-5 left-0 w-px',
          selected ? 'bg-primary' : 'bg-rule group-hover:bg-primary',
        )}
      />

      <h3 className="text-foreground text-base font-medium">{service.name}</h3>

      {service.description ? (
        <p className="text-muted-foreground mt-1 flex-1 text-sm">{service.description}</p>
      ) : (
        <div className="flex-1" />
      )}

      <div className="mt-4 flex items-baseline justify-between gap-4 font-mono">
        <span className="text-muted-foreground text-xs">
          {formatDurationText(service.durationMinutes)}
        </span>
        <span className="text-foreground text-base">
          {formatMoney(service.priceCents, currency)}
        </span>
      </div>
    </Link>
  )
}
