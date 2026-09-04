import { AlertDialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { formatWeekday } from '@/lib/time'
import type { DayOfWeek } from '@/types'
import { useTranslation } from '@/i18n'
import { formatList } from '@/i18n/list'

/**
 * The two questions the working-hours grid has to ask before it does something
 * a person cannot see coming.
 *
 * Both are `AlertDialog`s rather than `Dialog`s: each interrupts to ask about
 * something that loses work, so each traps focus, is announced as an alert, and
 * lands focus on the safe answer.
 */

const PANEL = [
  'bg-popover text-popover-foreground border-border fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))]',
  'shadow-e3 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6',
].join(' ')

/**
 * "Saving will remove Saturday."
 *
 * The `PUT` replaces the entire template, so a day that has been emptied in the
 * grid is deleted the moment Save is pressed — and the loss is exactly the kind
 * that gets discovered a week later as "my Saturday disappeared". A standing
 * note above the grid says the rule; this names the days, which is the only
 * form of the warning somebody actually reads.
 *
 * It appears **only** when the save would remove a day that had hours saved on
 * it. Closing a day that was already closed asks nothing, because nothing is
 * lost.
 */
export function RemovalConfirm({
  days,
  onConfirm,
  onCancel,
}: {
  days: readonly DayOfWeek[]
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const names = days.map((day) => formatWeekday(day))

  return (
    <AlertDialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <AlertDialog.Content className={PANEL}>
          <AlertDialog.Title className="text-foreground text-xl font-medium">
            {names.length === 1
              ? t('hours.removal.oneTitle', { day: names[0] ?? '' })
              : t('hours.removal.manyTitle', { count: names.length })}
          </AlertDialog.Title>

          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            {t('hours.removal.body', { count: names.length, days: formatList(names) })}
          </AlertDialog.Description>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">{t('hours.removal.goBack')}</Button>
            </AlertDialog.Cancel>
            {/* No pending state of its own: confirming closes this dialog and
                hands the wait to the Save button underneath, which is the one
                place the request's progress is reported. */}
            <Button variant="danger" onClick={onConfirm}>
              {t('hours.removal.confirm')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/**
 * "You have unsaved hours."
 *
 * Fired by `useUnsavedChanges` on a route change. The wording names what would
 * be lost rather than asking an abstract question — a native `window.confirm`
 * cannot, which is the reason this is a component at all.
 */
export function UnsavedChangesConfirm({
  onDiscard,
  onKeepEditing,
}: {
  onDiscard: () => void
  onKeepEditing: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog.Root open onOpenChange={(next) => !next && onKeepEditing()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <AlertDialog.Content className={PANEL}>
          <AlertDialog.Title className="text-foreground text-xl font-medium">
            {t('hours.leave.title')}
          </AlertDialog.Title>

          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            {t('hours.leave.body')}
          </AlertDialog.Description>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">{t('hours.leave.keep')}</Button>
            </AlertDialog.Cancel>
            <Button variant="danger" onClick={onDiscard}>
              {t('hours.leave.discard')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
