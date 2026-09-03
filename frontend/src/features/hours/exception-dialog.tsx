import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { FormField } from '@/components/form-field'
import { Modal } from '@/components/modal'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { FormAlert } from '@/components/form-alert'
import { useCreateOverride } from '@/features/hours/hours-queries'
import type { OverrideRequest } from '@/types'
import { translate, useTranslation, type TKey } from '@/i18n'

/**
 * Adding one override, at whichever of the two levels the session is allowed to
 * use.
 *
 * The form's job is to make the three shapes the API refuses **unreachable**
 * rather than merely handled:
 *
 * - a whole-day `EXTRA` — "available, from no time until no time" — so the
 *   whole-day control disappears the moment `EXTRA` is chosen;
 * - one time without the other, so there is a whole-day toggle instead of two
 *   inputs somebody can half-clear;
 * - a business-wide `EXTRA`, which would put a whole team on the booking page
 *   for an evening nobody agreed to, so the type control collapses to `BLOCKED`
 *   for a closure.
 *
 * A 422 is still handled. The form is an affordance and the server is the rule.
 */

/**
 * A validation message, as a dictionary key — see `services/service-form.ts` for
 * the argument. Identity, so a reader following a message from schema to screen
 * sees the key at both ends.
 */
function key(k: TKey): string {
  return k
}

/** One of those keys, back as prose, at render. */
function message(raw: string | undefined): string | undefined {
  return raw ? translate(raw as TKey) : undefined
}

const SCHEMA = z
  .object({
    date: z.string().min(1, key('hours.dialog.dateRequired')),
    scope: z.enum(['staff', 'business']),
    type: z.enum(['BLOCKED', 'EXTRA']),
    wholeDay: z.boolean(),
    startTime: z.string(),
    endTime: z.string(),
    reason: z.string().max(200, key('hours.dialog.reasonTooLong')),
  })
  .superRefine((values, context) => {
    if (values.wholeDay && values.type === 'BLOCKED') return

    for (const edge of ['startTime', 'endTime'] as const) {
      if (!values[edge]) {
        context.addIssue({ code: 'custom', path: [edge], message: key('hours.dialog.bothTimes') })
      }
    }
    if (values.startTime && values.startTime === values.endTime) {
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: key('hours.dialog.timesDiffer'),
      })
    }
  })

type ExceptionFormValues = z.infer<typeof SCHEMA>

type ExceptionDialogProps = {
  staffId: string
  staffName: string
  /** Owners may close the whole business; a staff member may only change their own days. */
  canCloseBusiness: boolean
  /** The month on screen, so the date input opens somewhere useful. */
  defaultDate: string
  onClose: () => void
}

export function ExceptionDialog({
  staffId,
  staffName,
  canCloseBusiness,
  defaultDate,
  onClose,
}: ExceptionDialogProps) {
  const { t } = useTranslation()
  const create = useCreateOverride()

  const form = useForm<ExceptionFormValues>({
    resolver: zodResolver(SCHEMA),
    defaultValues: {
      date: defaultDate,
      scope: 'staff',
      type: 'BLOCKED',
      wholeDay: true,
      startTime: '',
      endTime: '',
      reason: '',
    },
  })

  const { alert, reportFailure, clear } = useFormErrorSummary(form)

  // `useWatch` and not `form.watch()`, for the reason `service-form-dialog.tsx`
  // sets out: these subscribe to three named fields, where `form.watch()` during
  // render subscribes to the whole form and re-renders the dialog on every
  // keystroke in the reason field.
  const scope = useWatch({ control: form.control, name: 'scope' })
  const type = useWatch({ control: form.control, name: 'type' })
  const wholeDay = useWatch({ control: form.control, name: 'wholeDay' }) && type === 'BLOCKED'

  function submit(values: ExceptionFormValues) {
    clear()

    const timed = !(values.wholeDay && values.type === 'BLOCKED')
    const request: OverrideRequest = {
      date: values.date,
      type: values.type,
      // Omitted together, never sent as empty strings: absence is what "whole
      // day" means on the wire, and `""` would be a 400 from the deserialiser.
      ...(timed ? { startTime: `${values.startTime}:00`, endTime: `${values.endTime}:00` } : {}),
      ...(values.reason.trim() ? { reason: values.reason.trim() } : {}),
    }

    create.mutate(
      values.scope === 'business'
        ? { scope: 'business', request }
        : { scope: 'staff', staffId, request },
      {
        onSuccess: () => {
          toast.success(
            values.scope === 'business'
              ? t('hours.dialog.savedBusiness')
              : t('hours.dialog.savedStaff', { name: staffName }),
          )
          onClose()
        },
        onError: (error) => {
          reportFailure(error, {
            copy: {
              VALIDATION_FAILED: 'errors.checkDateAndTimes',
              ACCESS_DENIED: 'errors.hoursOnlyYourOwnDays',
            },
          })
        },
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Modal
      open
      onOpenChange={(next) => !next && !create.isPending && onClose()}
      title={t('hours.dialog.title')}
      description={t('hours.dialog.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={create.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="exception-form" disabled={create.isPending}>
            {create.isPending ? t('hours.dialog.saving') : t('hours.dialog.save')}
          </Button>
        </>
      }
    >
      {alert ? <FormAlert {...alert} /> : null}

      <form
        id="exception-form"
        noValidate
        onSubmit={form.handleSubmit(submit)}
        className="grid gap-5"
      >
        <FormField label={t('hours.dialog.date')} error={message(errors.date?.message)}>
          {(control) => (
            <Input type="date" {...control} {...form.register('date')} data-first-field />
          )}
        </FormField>

        {/* Prominent, and second, because it is the only thing that makes this
            row legible six weeks from now. "Closed" with no reason is a mystery
            an owner has to reconstruct. */}
        <FormField
          label={t('hours.dialog.reason')}
          hint={t('hours.dialog.reasonHint')}
          error={errors.reason?.message}
        >
          {(control) => <Input {...control} {...form.register('reason')} maxLength={200} />}
        </FormField>

        {canCloseBusiness ? (
          <FormField label={t('hours.dialog.scope')} error={message(errors.scope?.message)}>
            {(control) => (
              <select
                {...control}
                {...form.register('scope', {
                  // A closure is `BLOCKED` only: a business may declare itself
                  // shut on its staff's behalf, but not declare them available.
                  onChange: (event) => {
                    if (event.target.value === 'business') form.setValue('type', 'BLOCKED')
                  },
                })}
                className="border-input bg-card text-foreground h-9 w-full rounded-sm border px-3 text-sm"
              >
                <option value="staff">{t('hours.dialog.scopeStaff', { name: staffName })}</option>
                <option value="business">{t('hours.dialog.scopeBusiness')}</option>
              </select>
            )}
          </FormField>
        ) : null}

        <FormField
          label={t('hours.dialog.effect')}
          hint={t(
            type === 'BLOCKED' ? 'hours.dialog.effectBlockedHint' : 'hours.dialog.effectExtraHint',
          )}
          error={message(errors.type?.message)}
        >
          {(control) => (
            <select
              {...control}
              {...form.register('type')}
              disabled={scope === 'business'}
              className="border-input bg-card text-foreground h-9 w-full rounded-sm border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="BLOCKED">{t('hours.dialog.optionBlocked')}</option>
              {scope === 'business' ? null : (
                <option value="EXTRA">{t('hours.dialog.optionExtra')}</option>
              )}
            </select>
          )}
        </FormField>

        {type === 'BLOCKED' ? (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...form.register('wholeDay')} />
            {t('hours.dialog.wholeDay')}
          </label>
        ) : null}

        {wholeDay ? null : (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('hours.dialog.from')} error={message(errors.startTime?.message)}>
              {(control) => <Input type="time" {...control} {...form.register('startTime')} />}
            </FormField>
            <FormField label={t('hours.dialog.to')} error={message(errors.endTime?.message)}>
              {(control) => <Input type="time" {...control} {...form.register('endTime')} />}
            </FormField>
          </div>
        )}
      </form>
    </Modal>
  )
}
