import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { isApiError, problemCount, problemText } from '@/api/error'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { FormAlert } from '@/components/form-alert'
import { useUpdateBusiness } from '@/features/settings/settings-queries'
import { TimezoneDialog, type TimezoneShift } from '@/features/settings/timezone-dialog'
import { ZoneSuggestions } from '@/features/settings/zone-suggestions'
import type { Business, BusinessRequest } from '@/types'
import { translate, useTranslation, type TKey } from '@/i18n'

/**
 * Name, timezone, currency and the deposit rule.
 *
 * One form, four settings, and two of them carry a consequence the form has to
 * state rather than discover. The timezone is a two-step write and gets a dialog
 * ({@link TimezoneDialog}); the currency reinterprets every price in the
 * catalogue without converting one of them, and says so under the input.
 *
 * `slug` is shown and not editable. It is the public booking page's address and
 * there is no setter for it anywhere — a URL somebody has already sent to a
 * customer does not get to change.
 */

/**
 * A validation message, as a dictionary key — see `services/service-form.ts`.
 * Identity, so a reader following one from schema to screen sees the key at both
 * ends.
 */
function key(k: TKey): string {
  return k
}

/** One of those keys, back as prose, at render. */
function message(raw: string | undefined): string | undefined {
  return raw ? translate(raw as TKey) : undefined
}

const SCHEMA = z.object({
  // Keys, not sentences — see `services/service-form.ts`. `message()` below
  // resolves them at render.
  name: z
    .string()
    .trim()
    .min(1, key('settings.business.nameRequired'))
    .max(120, key('settings.business.nameTooLong')),
  timezone: z.string().trim().min(1, key('settings.business.timezoneRequired')).max(64),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, key('settings.business.currencyShape')),
  depositRequired: z.boolean(),
  depositPercent: z.coerce
    .number<number>()
    .int(key('settings.business.wholeNumbers'))
    .min(0, key('settings.business.percentRange'))
    .max(100, key('settings.business.percentRange')),
})

type BusinessFormValues = z.input<typeof SCHEMA>

export function BusinessForm({ business }: { business: Business }) {
  const { t } = useTranslation()
  const update = useUpdateBusiness()
  const zoneListId = useId()
  const [shift, setShift] = useState<TimezoneShift | null>(null)

  const form = useForm<BusinessFormValues, unknown, z.output<typeof SCHEMA>>({
    resolver: zodResolver(SCHEMA),
    defaultValues: {
      name: business.name,
      timezone: business.timezone,
      currency: business.currency,
      depositRequired: business.depositRequired,
      depositPercent: business.depositPercent,
    },
  })

  const { alert, reportFailure, clear } = useFormErrorSummary(form)

  const depositRequired = useWatch({ control: form.control, name: 'depositRequired' })
  const depositEntry = useWatch({ control: form.control, name: 'depositPercent' })
  /**
   * Zero, **as opposed to nothing yet**. A cleared number input holds `''` and
   * `Number('')` is `0`, so reading it as a number would put the "a percentage
   * of zero means no deposit" warning on screen the moment somebody selects the
   * field to retype it — an accusation about a value they have not entered.
   */
  const depositIsZero = `${depositEntry ?? ''}`.trim() !== '' && Number(depositEntry) === 0

  /**
   * The one request builder, and the **only** place `confirmShift` is ever set.
   *
   * It is a parameter rather than a field on the form, so there is no path by
   * which a first attempt can carry it: `submit` calls this with nothing, and
   * the dialog's confirm button is the sole caller that passes `true`.
   */
  function send(values: z.output<typeof SCHEMA>, confirmShift?: true) {
    clear()

    const request: BusinessRequest = {
      name: values.name,
      timezone: values.timezone,
      currency: values.currency,
      depositRequired: values.depositRequired,
      depositPercent: values.depositPercent,
      ...(confirmShift ? { confirmShift } : {}),
    }

    update.mutate(request, {
      onSuccess: (saved) => {
        setShift(null)
        form.reset({ ...values, currency: saved.currency, timezone: saved.timezone })
        toast.success(
          confirmShift
            ? t('settings.business.movedTo', { zone: saved.timezone })
            : t('settings.business.saved'),
          {
            description: confirmShift ? t('settings.business.movedNote') : undefined,
          },
        )
      },
      onError: (error) => {
        if (isApiError(error, 'TIMEZONE_SHIFT_UNCONFIRMED')) {
          // The refusal is the prompt. Both zone ids come off the problem body
          // rather than out of the form: the server resolved and validated them,
          // and `Europe/paris` typed into the input is not what it stored.
          setShift({
            from: problemText(error, 'currentTimezone') ?? business.timezone,
            to: problemText(error, 'requestedTimezone') ?? values.timezone,
            bookings: problemCount(error, 'affectedBookings'),
          })
          return
        }

        setShift(null)
        reportFailure(error, {
          copy: {
            VALIDATION_FAILED: 'errors.checkFieldsBelow',
            ACCESS_DENIED: 'errors.ownerOnlyBusiness',
          },
        })
      },
    })
  }

  const errors = form.formState.errors

  return (
    <section aria-labelledby="business-settings">
      <h2 id="business-settings" className="font-display text-foreground text-lg">
        {t('settings.business.heading')}
      </h2>

      <form
        noValidate
        onSubmit={form.handleSubmit((values) => send(values))}
        className="max-w-copy mt-4 grid gap-5"
      >
        {alert ? <FormAlert {...alert} /> : null}

        <FormField label={t('settings.business.name')} error={message(errors.name?.message)}>
          {(control) => (
            <Input {...control} {...form.register('name')} autoComplete="organization" />
          )}
        </FormField>

        <FormField label={t('settings.business.slug')} hint={t('settings.business.slugHint')}>
          {(control) => (
            <Input
              {...control}
              value={`/b/${business.slug}`}
              readOnly
              disabled
              className="font-mono"
            />
          )}
        </FormField>

        <FormField
          label={t('settings.business.timezone')}
          hint={t('settings.business.timezoneHint')}
          error={errors.timezone?.message}
        >
          {(control) => (
            <>
              {/* A datalist rather than a select: the browser's tz database and
                  the server's can differ by a release, and the server is the one
                  that decides. Suggestions help; refusing a zone this browser has
                  not heard of would black out a tenant over a rename. */}
              <Input
                {...control}
                {...form.register('timezone')}
                list={zoneListId}
                className="font-mono"
              />
              <ZoneSuggestions id={zoneListId} />
            </>
          )}
        </FormField>

        <FormField
          label={t('settings.business.currency')}
          hint={t('settings.business.currencyHint')}
          error={errors.currency?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('currency')}
              maxLength={3}
              className="w-24 font-mono uppercase"
            />
          )}
        </FormField>

        <fieldset className="border-rule grid gap-3 border-t pt-5">
          <legend className="sr-only">{t('settings.business.deposits')}</legend>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox {...form.register('depositRequired')} />
            {t('settings.business.askDeposit')}
          </label>

          <FormField
            label={t('settings.business.depositPercent')}
            hint={t('settings.business.depositPercentHint')}
            error={errors.depositPercent?.message}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={100}
                {...form.register('depositPercent')}
                className="w-24"
              />
            )}
          </FormField>

          {/* Two honest notes the screen owes the reader, and neither is
              hypothetical on this deployment. */}
          {depositRequired && depositIsZero ? (
            <p className="border-warning/50 bg-warning-wash text-foreground rounded-sm border px-3 py-2 text-sm">
              <strong className="font-medium">{t('settings.business.zeroLead')}</strong>{' '}
              {t('settings.business.zeroBody')}
            </p>
          ) : null}

          <p className="text-muted-foreground text-xs">{t('settings.business.paymentsNote')}</p>
        </fieldset>

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending && !shift
              ? t('settings.business.saving')
              : t('settings.business.save')}
          </Button>
        </div>
      </form>

      {shift ? (
        <TimezoneDialog
          shift={shift}
          saving={update.isPending}
          onConfirm={() => send(SCHEMA.parse(form.getValues()), true)}
          onCancel={() => setShift(null)}
        />
      ) : null}
    </section>
  )
}
