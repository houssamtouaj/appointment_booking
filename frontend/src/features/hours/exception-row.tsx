import { Building2, CalendarMinus, CalendarPlus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatDayHeading, formatLocalTime } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Override } from '@/types'
import { useTranslation } from '@/i18n'

type ExceptionRowProps = {
  override: Override
  /** False for a business-wide closure seen by a staff member: theirs to obey, not to remove. */
  removable: boolean
  busy: boolean
  onRemove: () => void
}

/**
 * One override, drawn as the operation it is.
 *
 * **`BLOCKED` and `EXTRA` are two visually distinct things, not two labels on
 * one chip.** They are opposite operations — "closed for Christmas" removes
 * time, "open late on Thursday" adds it — and a list that distinguishes them
 * only by a word makes an owner read every row to find the one that is wrong.
 * So they take opposite icons, opposite accent washes, and a left edge that
 * carries the colour down the row.
 *
 * A business-wide closure is marked as well as coloured, because the difference
 * between "I am off" and "we are all shut" is the whole reason the second exists
 * (backend D5).
 */
export function ExceptionRow({ override, removable, busy, onRemove }: ExceptionRowProps) {
  const { t } = useTranslation()
  const blocked = override.type === 'BLOCKED'
  const Icon = blocked ? CalendarMinus : CalendarPlus

  return (
    <li
      className={cn(
        'bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-sm border border-l-4 px-4 py-3',
        blocked ? 'border-danger/30 border-l-danger' : 'border-success/30 border-l-success',
        busy && 'opacity-50',
      )}
    >
      <span
        className={cn(
          'inline-flex size-8 shrink-0 items-center justify-center rounded-sm',
          blocked ? 'bg-danger-wash text-danger' : 'bg-success-wash text-success',
        )}
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">
          {formatDayHeading(override.date)}
          <span className="text-muted-foreground ml-2 font-normal">
            {override.wholeDay
              ? blocked
                ? 'closed all day'
                : 'all day'
              : `${formatLocalTime(override.startTime ?? '')} – ${formatLocalTime(override.endTime ?? '')}`}
          </span>
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {/* The type in words as well as in colour — colour is never the only
              carrier of a distinction this load-bearing. */}
          {t(blocked ? 'hours.overrides.blocked' : 'hours.overrides.extra')}
          {override.reason ? ` · ${override.reason}` : ''}
        </p>
      </div>

      {override.businessWide ? (
        <span className="border-border text-muted-foreground inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-xs">
          <Building2 className="size-3" aria-hidden="true" />
          {t('hours.overrides.wholeBusiness')}
        </span>
      ) : null}

      {removable ? (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={t('hours.overrides.remove', { date: formatDayHeading(override.date) })}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : (
        // A staff member sees the closure that is about to empty their Tuesday
        // and cannot lift it. Saying why is better than an absent button.
        <span className="text-muted-foreground text-xs">{t('hours.overrides.setByOwner')}</span>
      )}
    </li>
  )
}
