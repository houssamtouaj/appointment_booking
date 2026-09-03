import { AlertDialog } from 'radix-ui'

import { isApiError, problemInstant } from '@/api/error'
import { describeError } from '@/api/error-copy'
import { Button } from '@/components/ui/button'
import { clockOf, dayKeyOf, formatDayHeading } from '@/lib/time'
import type { PublicBooking } from '@/types'
import { translate, useTranslation } from '@/i18n'

type CancelDialogProps = {
  booking: PublicBooking
  /** The viewer's zone — see `manage-booking-page.tsx` for why it is not the business's. */
  timeZone: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  cancelling: boolean
  /** The failed `DELETE`, if one has failed. `409 CANCELLATION_CUTOFF` is a designed state. */
  error: unknown
}

/**
 * "Cancel this booking?" — and the money sentence, before the click.
 *
 * **`depositRefundable: false` is stated in words** (backend D7). It is a field
 * on the response precisely so that it can be rendered here rather than buried
 * in a terms page: refunds are out of scope in this version, the deposit is kept
 * whether or not the customer cancels, and that has to be disclosed before the
 * irreversible button rather than discovered afterwards.
 *
 * An `AlertDialog` and not a `Dialog`: this interrupts to ask about something
 * that cannot be undone, so it takes focus, traps it, has no dismiss-by-click-
 * outside affordance as its primary exit, and is announced as an alert. The
 * "Keep it" action is the one focus lands on.
 *
 * The failure lives **inside** the dialog rather than in a toast. A `409
 * CANCELLATION_CUTOFF` is not a transient hiccup — it is an answer, with a
 * deadline in it, to the question the dialog just asked, and it belongs where
 * the question was asked.
 */
export function CancelDialog({
  booking,
  timeZone,
  open,
  onOpenChange,
  onConfirm,
  cancelling,
  error,
}: CancelDialogProps) {
  const { t } = useTranslation()
  const cutoff = isApiError(error, 'CANCELLATION_CUTOFF')
  const deadline = problemInstant(error, 'deadline') ?? booking.cancellationDeadline

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <AlertDialog.Content
          className={[
            'bg-popover text-popover-foreground border-border fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))]',
            'shadow-e3 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6',
          ].join(' ')}
        >
          <AlertDialog.Title className="text-foreground text-xl font-medium">
            {t('booking.cancel.dialogTitle')}
          </AlertDialog.Title>

          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            {t('booking.cancel.dialogBody', { when: formatWhen(booking.startsAt, timeZone) })}
          </AlertDialog.Description>

          {booking.depositRefundable ? null : (
            <p className="border-destructive/40 bg-danger-wash text-foreground mt-4 rounded-sm border px-3 py-2 text-sm">
              {t('booking.cancel.notRefunded')}
            </p>
          )}

          {error ? (
            <div
              role="alert"
              className="border-border bg-muted text-foreground mt-4 rounded-sm border px-3 py-2 text-sm"
            >
              {cutoff ? (
                <>
                  <p className="font-medium">{t('booking.cancel.cutoffTitle')}</p>
                  <p className="text-muted-foreground mt-1">
                    {t('booking.cancel.cutoffBody', { when: formatWhen(deadline, timeZone) })}
                  </p>
                </>
              ) : (
                <p>{describeError(error)}</p>
              )}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              {/* The safe action, and the one focus lands on. */}
              <Button variant="outline">{t('booking.cancel.keep')}</Button>
            </AlertDialog.Cancel>
            {/* Deliberately not wrapped in AlertDialog.Action: that closes the
                dialog on click, which would take the cutoff answer off screen
                the instant the server gave it. The dialog closes on success
                instead, from the mutation. */}
            <Button variant="danger" disabled={cancelling || cutoff} onClick={onConfirm}>
              {cancelling ? t('booking.cancel.cancelling') : t('booking.cancel.confirm')}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/** A day and a clock on the business's own clock, joined by the dictionary. */
function formatWhen(instant: string, timeZone: string): string {
  return translate('booking.summary.dateAtTime', {
    date: formatDayHeading(dayKeyOf(instant, timeZone)),
    time: clockOf(instant, timeZone),
  })
}
