import { zodResolver } from '@hookform/resolvers/zod'
import { useId, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { applyFieldErrors, isApiError, problemCount, problemText } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { FormAlert } from '@/features/auth/form-alert'
import { useUpdateBusiness } from '@/features/settings/settings-queries'
import { TimezoneDialog, type TimezoneShift } from '@/features/settings/timezone-dialog'
import { ZoneSuggestions } from '@/features/settings/zone-suggestions'
import type { Business, BusinessRequest, ValidationError } from '@/types'

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

const SCHEMA = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep it under 120 characters'),
  timezone: z.string().trim().min(1, 'Enter a timezone').max(64),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'Three letters, like EUR or GBP'),
  depositRequired: z.boolean(),
  depositPercent: z.coerce
    .number<number>()
    .int('Whole numbers only')
    .min(0, 'Between 0 and 100')
    .max(100, 'Between 0 and 100'),
})

type BusinessFormValues = z.input<typeof SCHEMA>

export function BusinessForm({ business }: { business: Business }) {
  const update = useUpdateBusiness()
  const zoneListId = useId()
  const [shift, setShift] = useState<TimezoneShift | null>(null)
  const [alert, setAlert] = useState<{
    message: string
    unmatched: ValidationError[]
    requestId?: string
  } | null>(null)

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
    setAlert(null)

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
          confirmShift ? `The business is now on ${saved.timezone}.` : 'Your settings are saved.',
          {
            description: confirmShift ? 'Every screen is now drawn in the new zone.' : undefined,
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
        const unmatched = applyFieldErrors(error, form)
        setAlert({
          message: describeError(error, {
            VALIDATION_FAILED: 'Check the fields marked below.',
            ACCESS_DENIED: 'Only an owner can change the business settings.',
          }),
          unmatched,
          requestId: requestIdOf(error),
        })
      },
    })
  }

  const errors = form.formState.errors

  return (
    <section aria-labelledby="business-settings">
      <h2 id="business-settings" className="font-display text-foreground text-lg">
        Business
      </h2>

      <form
        noValidate
        onSubmit={form.handleSubmit((values) => send(values))}
        className="max-w-copy mt-4 grid gap-5"
      >
        {alert ? (
          <FormAlert
            message={alert.message}
            unmatched={alert.unmatched}
            requestId={alert.requestId}
          />
        ) : null}

        <FormField label="Name" error={errors.name?.message}>
          {(control) => (
            <Input {...control} {...form.register('name')} autoComplete="organization" />
          )}
        </FormField>

        <FormField
          label="Booking page address"
          hint="Permanent. Changing it would break every link already sent to a customer, so there is no way to."
        >
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
          label="Timezone"
          hint="Working hours are read in this zone. Changing it moves every future slot, and asks first."
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
          label="Currency"
          hint="ISO 4217, three letters. It is the unit of every price you have already set — changing it reinterprets them and converts nothing."
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
          <legend className="sr-only">Deposits</legend>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...form.register('depositRequired')}
              className="border-input accent-primary size-4 rounded-xs border"
            />
            Ask for a deposit when a customer books
          </label>

          <FormField
            label="Deposit percentage"
            hint="0 to 100."
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
              A percentage of zero means <strong className="font-medium">no deposit</strong>,
              whatever the checkbox says. That is what the booking page reports too.
            </p>
          ) : null}

          <p className="text-muted-foreground text-xs">
            Deposits are taken only when payments are configured for this deployment. This setting
            is stored either way, and the booking response is what decides whether a customer is
            asked for money.
          </p>
        </fieldset>

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending && !shift ? 'Saving…' : 'Save business settings'}
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
