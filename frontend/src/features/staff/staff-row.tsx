import {
  CircleCheck,
  MailWarning,
  Pencil,
  RotateCcw,
  Send,
  UserMinus,
  type LucideIcon,
} from 'lucide-react'

import { Monogram } from '@/components/monogram'
import { Button } from '@/components/ui/button'
import { lastOwnerReason, standingOf, type StaffState } from '@/features/staff/staff-state'
import type { Lookups } from '@/hooks/use-lookups'
import { cn } from '@/lib/utils'
import type { Staff } from '@/types'
import { translate, useTranslation } from '@/i18n'

/**
 * One colleague, as a row: who they are, what they can do, what state their
 * account is in, and what they perform.
 *
 * The state chip is the row's whole reason for being three lines rather than one.
 * Three of the four states are things an owner has to *do* something about, and
 * the action that fixes each one is different — so the chip and the button beside
 * it are chosen together, from `standingOf`.
 */

const CHIP_BASE = [
  'inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5',
  'text-xs font-medium whitespace-nowrap',
].join(' ')

/**
 * Never a colour on its own — the same rule the calendar's tiles and the
 * catalogue's chips follow, for the same two reasons: colour blindness, and
 * greyscale screenshots. Each state has a distinct fill *lightness*, a distinct
 * edge, and a glyph.
 */
const STATE_STYLE: Record<StaffState, string> = {
  active: 'border-success/45 bg-success-wash text-foreground',
  // Dashed: waiting on somebody else. The device `PENDING` uses on a booking.
  invited: 'border-dashed border-info/60 bg-info-wash text-foreground',
  // Dotted and hollow: it did not fail, it ran out — a different fact from
  // "waiting", and one that needs a different edge to be read as different.
  lapsed: 'border-dotted border-danger/70 bg-transparent text-foreground',
  deactivated: 'border-border bg-muted text-muted-foreground',
}

const STATE_ICON: Record<StaffState, LucideIcon> = {
  active: CircleCheck,
  invited: Send,
  lapsed: MailWarning,
  deactivated: UserMinus,
}

type StaffRowProps = {
  person: Staff
  /** The whole roster, for the last-owner guard. */
  team: readonly Staff[]
  lookups: Lookups
  onEdit: (person: Staff) => void
  onResend: (person: Staff) => void
  onDeactivate: (person: Staff) => void
  onReactivate: (person: Staff) => void
  /** True while a write against **this** row is in flight. */
  busy: boolean
}

export function StaffRow({
  person,
  team,
  lookups,
  onEdit,
  onResend,
  onDeactivate,
  onReactivate,
  busy,
}: StaffRowProps) {
  const { t } = useTranslation()
  const standing = standingOf(person)
  const StateIcon = STATE_ICON[standing.state]
  const cannotDeactivate = lastOwnerReason(person, team)
  const services = performedServices(person, lookups)

  return (
    <li
      className={cn(
        'border-border bg-card rounded-md border px-4 py-3 transition-opacity',
        !person.active && 'opacity-80',
        busy && 'opacity-60',
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <Monogram fullName={person.fullName} size="lg" muted={!person.active} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-foreground truncate text-sm font-medium">{person.fullName}</h2>

            {/* The role, as plain text rather than a second chip. Two chips on a
                row compete, and the state is the one that needs the attention. */}
            <span className="text-muted-foreground text-xs">
              {t(person.role === 'OWNER' ? 'team.owner' : 'team.staff')}
            </span>

            <span className={cn(CHIP_BASE, STATE_STYLE[standing.state])}>
              <StateIcon className="size-3.5" aria-hidden="true" />
              {t(standing.label)}
            </span>
          </div>

          <p className="text-muted-foreground mt-1 truncate text-xs">{person.email}</p>
          <p className="text-muted-foreground mt-1 text-xs">{t(standing.note)}</p>

          <p className="text-muted-foreground mt-1.5 text-xs">
            {services === null ? (
              // The lookups have not answered. Says so rather than claiming
              // "performs nothing", which is a different and alarming fact.
              <span className="italic">{t('team.loadingPerformed')}</span>
            ) : services.length === 0 ? (
              <span className="italic">{t('team.performsNothing')}</span>
            ) : (
              <>
                <span className="text-foreground">{t('team.performs')}</span> {services.join(', ')}
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => onEdit(person)} disabled={busy}>
            <Pencil aria-hidden="true" />
            {t('team.editAction')}
            <span className="sr-only"> {person.fullName}</span>
          </Button>

          {standing.action === 'resend' ? (
            <Button variant="ghost" size="sm" onClick={() => onResend(person)} disabled={busy}>
              <Send aria-hidden="true" />
              {t('team.resendInvitation')}
              <span className="sr-only"> to {person.fullName}</span>
            </Button>
          ) : null}

          {standing.action === 'reactivate' ? (
            <Button variant="ghost" size="sm" onClick={() => onReactivate(person)} disabled={busy}>
              <RotateCcw aria-hidden="true" />
              {t('team.reactivate')}
              <span className="sr-only"> {person.fullName}</span>
            </Button>
          ) : null}

          {person.active ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeactivate(person)}
              // The only active owner cannot be deactivated. Disabled with the
              // reason attached in **both** channels: `title` for a pointer, and
              // `aria-describedby` pointing at the sentence rendered below, so a
              // screen reader is not left with a button it cannot press and no
              // idea why.
              disabled={busy || cannotDeactivate !== undefined}
              title={cannotDeactivate}
              aria-describedby={cannotDeactivate ? `${person.id}-last-owner` : undefined}
            >
              <UserMinus aria-hidden="true" />
              {t('team.deactivate')}
              <span className="sr-only"> {person.fullName}</span>
            </Button>
          ) : null}
        </div>
      </div>

      {cannotDeactivate && person.active ? (
        <p
          id={`${person.id}-last-owner`}
          className="text-muted-foreground border-rule mt-3 border-t pt-2 text-xs"
        >
          {cannotDeactivate}
        </p>
      ) : null}
    </li>
  )
}

/** How many service names fit on a row before it stops being a row. */
const SERVICES_SHOWN = 4

/**
 * What this person performs, by name, or `null` while the lookups are still out.
 *
 * Archived services are included and marked. A colleague assigned to a service
 * that has since been deactivated is not performing anything today, and hiding
 * the assignment would make the row disagree with the catalogue's Edit dialog,
 * which shows the tick.
 */
function performedServices(person: Staff, lookups: Lookups): string[] | null {
  if (lookups.isLoading) return null

  const names = person.serviceIds
    .map((id) => lookups.serviceById.get(id))
    .filter((service): service is NonNullable<typeof service> => service !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((service) => (service.active ? service.name : `${service.name} (archived)`))

  if (names.length <= SERVICES_SHOWN) return names
  return [
    ...names.slice(0, SERVICES_SHOWN),
    translate('team.andMore', { count: names.length - SERVICES_SHOWN }),
  ]
}
