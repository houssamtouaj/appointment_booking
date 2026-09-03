import { AlertDialog } from 'radix-ui'

import { Button } from '@/components/ui/button'
import { zoneAbbreviation } from '@/lib/time'
import { translate, useTranslation } from '@/i18n'

export type TimezoneShift = {
  /** The zone the tenant is on now, as the **server** named it in the refusal. */
  from: string
  /** The zone it would move to, likewise. */
  to: string
  /**
   * `affectedBookings` from the problem body, or `undefined` when the member was
   * missing or not a number.
   *
   * Zero and unknown are different sentences and the dialog says both. Zero is
   * common and true — the 409 arrives whether or not anything is booked, because
   * the bookings are the visible consequence and not the reason.
   */
  bookings?: number
}

/**
 * The `409 TIMEZONE_SHIFT_UNCONFIRMED`, rendered as the conversation the API
 * meant it to be.
 *
 * **The 409 is the prompt, and it is never pre-empted.** The request that
 * produced it did not carry `confirmShift`, deliberately: sending the flag on a
 * first attempt would make the endpoint answer 200 and remove the only warning
 * an owner gets before every future slot moves. So this dialog is the *second*
 * step of a two-step write, and the confirm button below is the only place in
 * the app that sets the flag.
 *
 * What it has to say, and why each part is here rather than in a shorter
 * sentence:
 *
 * - **Both zones by name**, because "the timezone will change" is not a fact
 *   anybody can check, and the two ids come from the server rather than from the
 *   form — the server resolved and validated them, and the form holds a string
 *   somebody typed.
 * - **What actually happens to existing appointments.** Working hours are
 *   wall-clock times read in this zone, so "we open at nine" starts meaning a
 *   different instant. Nothing is rewritten and nothing is converted — the
 *   backend is explicit that normalising either would be the application
 *   inventing an intention — so the appointments keep their wall-clock times in
 *   the new zone.
 * - **The count**, when the server sent one.
 */
export function TimezoneDialog({
  shift,
  saving,
  onConfirm,
  onCancel,
}: {
  shift: TimezoneShift
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <AlertDialog.Root open onOpenChange={(next) => !next && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="bg-scrim fixed inset-0 z-50" />
        <AlertDialog.Content
          className={[
            'bg-popover text-popover-foreground border-border fixed top-1/2 left-1/2 z-50 w-[min(30rem,calc(100vw-2rem))]',
            'shadow-e3 -translate-x-1/2 -translate-y-1/2 rounded-lg border p-6',
          ].join(' ')}
        >
          <AlertDialog.Title className="text-foreground text-xl font-medium">
            {t('settings.timezone.title', { to: shift.to })}
          </AlertDialog.Title>

          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm">
            {t('settings.timezone.body', { to: shift.to, from: shift.from })}
          </AlertDialog.Description>

          <dl className="border-rule mt-4 grid grid-cols-2 gap-px border-y py-3 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">{t('settings.timezone.now')}</dt>
              <dd className="text-foreground font-mono">
                {shift.from}
                <span className="text-muted-foreground ml-2 font-sans text-xs">
                  {zoneAbbreviation(shift.from)}
                </span>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">{t('settings.timezone.after')}</dt>
              <dd className="text-foreground font-mono">
                {shift.to}
                <span className="text-muted-foreground ml-2 font-sans text-xs">
                  {zoneAbbreviation(shift.to)}
                </span>
              </dd>
            </div>
          </dl>

          <p className="text-muted-foreground mt-4 text-sm">
            {t('settings.timezone.footnote', { bookings: describeBookings(shift.bookings) })}
          </p>

          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <AlertDialog.Cancel asChild>
              {/* The safe answer, and the one focus lands on. */}
              <Button variant="outline">{t('settings.timezone.keep', { from: shift.from })}</Button>
            </AlertDialog.Cancel>
            <Button variant="danger" disabled={saving} onClick={onConfirm}>
              {saving
                ? t('settings.timezone.saving')
                : t('settings.timezone.move', { to: shift.to })}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

/**
 * The count as a whole sentence, so the verb can agree with it.
 *
 * `Intl.PluralRules` rather than two ternaries: this had `count === 1 ? '' : 's'`
 * *and* `count === 1 ? 'is' : 'are'`, and French agrees both differently and at
 * a different boundary. Zero keeps its own sentence, which is what a person says.
 */
function describeBookings(count: number | undefined): string {
  if (count === undefined) return translate('settings.timezone.bookingsUnknown')
  if (count === 0) return translate('settings.timezone.bookingsNone')
  return translate('settings.timezone.bookingsCount', { count })
}
