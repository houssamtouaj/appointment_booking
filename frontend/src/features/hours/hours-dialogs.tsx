import { AlertDialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { formatWeekday } from '@/lib/time'
import type { DayOfWeek } from '@/types'

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
  saving,
  onConfirm,
  onCancel,
}: {
  days: readonly DayOfWeek[]
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const names = days.map((day) => formatWeekday(day))

  return (
    <AlertDialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <AlertDialog.Content className={PANEL}>
          <AlertDialog.Title className="text-foreground text-xl font-medium">
            {names.length === 1
              ? `${names[0]} will no longer be worked`
              : `${names.length} days will no longer be worked`}
          </AlertDialog.Title>

          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            Saving replaces the whole week, so {formatList(names)} will have no hours at all and
            nothing can be booked on {names.length === 1 ? 'it' : 'them'}. Existing appointments
            stay in the calendar.
          </AlertDialog.Description>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Go back</Button>
            </AlertDialog.Cancel>
            <Button variant="danger" disabled={saving} onClick={onConfirm}>
              {saving ? 'Saving…' : 'Save and remove'}
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
  return (
    <AlertDialog.Root open onOpenChange={(next) => !next && onKeepEditing()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <AlertDialog.Content className={PANEL}>
          <AlertDialog.Title className="text-foreground text-xl font-medium">
            Leave without saving these hours?
          </AlertDialog.Title>

          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            The weekly grid has changes that have not been sent. Leaving now discards them and the
            saved template stays as it was.
          </AlertDialog.Description>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              <Button variant="outline">Keep editing</Button>
            </AlertDialog.Cancel>
            <Button variant="danger" onClick={onDiscard}>
              Discard changes
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/** `Monday`, `Monday and Tuesday`, `Monday, Tuesday and Saturday`. */
function formatList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
