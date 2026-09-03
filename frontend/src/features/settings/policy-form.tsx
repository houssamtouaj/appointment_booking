import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { SLOT_GRANULARITIES } from '@/api/schemas/policy'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { FormAlert } from '@/components/form-alert'
import { describeCutoff, describePolicy, POLICY_HINTS } from '@/features/settings/policy-copy'
import { useUpdatePolicy } from '@/features/settings/settings-queries'
import type { Policy } from '@/types'
import { translate, useTranslation, type TKey } from '@/i18n'

/**
 * The four numbers a customer feels.
 *
 * **`slotGranularityMinutes` is a select and never a number input.** It is a
 * closed enum on the wire — 5, 10, 15, 20, 30 or 60 — so a free number input
 * produces a `422` on every value that is not one of six, which is almost every
 * value somebody can type. The same six are mirrored in the Zod schema
 * (`SLOT_GRANULARITIES`), so a resolver failure and a server refusal cannot
 * disagree about which numbers exist.
 *
 * The preview under the form is the point of the screen: four independent
 * integers are hard to hold in your head, and this is where getting them wrong
 * is invisible until nobody can book.
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
  minLeadTimeHours: z.coerce
    .number<number>()
    .int(key('settings.policy.wholeHours'))
    .min(0, key('settings.policy.hoursRange'))
    .max(168, key('settings.policy.hoursRange')),
  maxAdvanceDays: z.coerce
    .number<number>()
    .int(key('settings.policy.wholeDays'))
    .min(1, key('settings.policy.daysRange'))
    .max(365, key('settings.policy.daysRange')),
  cancellationCutoffHours: z.coerce
    .number<number>()
    .int(key('settings.policy.wholeHours'))
    .min(0, key('settings.policy.hoursRange'))
    .max(168, key('settings.policy.hoursRange')),
  slotGranularityMinutes: z.coerce.number<number>().pipe(z.literal(SLOT_GRANULARITIES)),
})

type PolicyFormValues = z.input<typeof SCHEMA>

export function PolicyForm({ policy }: { policy: Policy }) {
  const { t } = useTranslation()
  const update = useUpdatePolicy()

  const form = useForm<PolicyFormValues, unknown, z.output<typeof SCHEMA>>({
    resolver: zodResolver(SCHEMA),
    defaultValues: {
      minLeadTimeHours: policy.minLeadTimeHours,
      maxAdvanceDays: policy.maxAdvanceDays,
      cancellationCutoffHours: policy.cancellationCutoffHours,
      slotGranularityMinutes: policy.slotGranularityMinutes,
    },
  })

  const { alert, reportFailure, clear } = useFormErrorSummary(form)

  // Read live so the preview moves with the inputs rather than with the last
  // save — the sentence is there to be checked *before* the button.
  const draft = {
    minLeadTimeHours: entered(useWatch({ control: form.control, name: 'minLeadTimeHours' })),
    maxAdvanceDays: entered(useWatch({ control: form.control, name: 'maxAdvanceDays' })),
    cancellationCutoffHours: entered(
      useWatch({ control: form.control, name: 'cancellationCutoffHours' }),
    ),
    slotGranularityMinutes: entered(
      useWatch({ control: form.control, name: 'slotGranularityMinutes' }),
    ),
  }
  const readable = Object.values(draft).every((value) => Number.isFinite(value))

  function submit(values: z.output<typeof SCHEMA>) {
    clear()

    update.mutate(values, {
      onSuccess: (saved) => {
        form.reset(saved)
        toast.success(translate('settings.policy.saved'), { description: describePolicy(saved) })
      },
      onError: (error) => {
        reportFailure(error, {
          copy: {
            VALIDATION_FAILED: 'errors.checkNumbersBelow',
            ACCESS_DENIED: 'errors.ownerOnlyPolicy',
          },
        })
      },
    })
  }

  const errors = form.formState.errors

  return (
    <section aria-labelledby="booking-policy" className="mt-12">
      <h2 id="booking-policy" className="font-display text-foreground text-lg">
        {t('settings.policy.heading')}
      </h2>

      <form noValidate onSubmit={form.handleSubmit(submit)} className="max-w-copy mt-4 grid gap-5">
        {alert ? <FormAlert {...alert} /> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label={t('settings.policy.minLeadTime')}
            hint={t(POLICY_HINTS.minLeadTimeHours)}
            error={message(errors.minLeadTimeHours?.message)}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={168}
                {...form.register('minLeadTimeHours')}
              />
            )}
          </FormField>

          <FormField
            label={t('settings.policy.maxAdvance')}
            hint={t(POLICY_HINTS.maxAdvanceDays)}
            error={message(errors.maxAdvanceDays?.message)}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={1}
                max={365}
                {...form.register('maxAdvanceDays')}
              />
            )}
          </FormField>

          <FormField
            label={t('settings.policy.cutoff')}
            hint={t(POLICY_HINTS.cancellationCutoffHours)}
            error={message(errors.cancellationCutoffHours?.message)}
          >
            {(control) => (
              <Input
                {...control}
                type="number"
                min={0}
                max={168}
                {...form.register('cancellationCutoffHours')}
              />
            )}
          </FormField>

          <FormField
            label={t('settings.policy.slotStep')}
            hint={t(POLICY_HINTS.slotGranularityMinutes)}
            error={message(errors.slotGranularityMinutes?.message)}
          >
            {(control) => (
              // A select over the enum. See this file's header: the API accepts
              // exactly these six, and a number input is a 422 generator.
              <select
                {...control}
                {...form.register('slotGranularityMinutes')}
                className="border-input bg-card text-foreground h-9 w-full rounded-sm border px-3 text-sm"
              >
                {SLOT_GRANULARITIES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        <div className="border-primary bg-card border-l-2 py-2 pl-4" aria-live="polite">
          {readable ? (
            <>
              <p className="text-foreground text-sm">{describePolicy(draft)}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {describeCutoff(draft.cancellationCutoffHours)}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t('settings.policy.incomplete')}</p>
          )}
        </div>

        {/* Correct, and worth saying once: the API allows it and does not move
            anything, so a warning implying otherwise would be inventing a
            consequence. */}
        <p className="text-muted-foreground text-xs">{t('settings.policy.stepNote')}</p>

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending ? t('settings.policy.saving') : t('settings.policy.save')}
          </Button>
        </div>
      </form>
    </section>
  )
}

/**
 * What one input actually holds, as a number — **with an emptied field as `NaN`
 * rather than as zero.**
 *
 * `Number('')` is `0`, and a number input that somebody has cleared holds `''`.
 * Reading it as zero made the preview state a rule the form does not hold and
 * the API would refuse: clear the booking window and the sentence read
 * "customers can book … up to 0 days out" instead of asking for the missing
 * number, because the "fill in all four" branch below could never be reached.
 */
function entered(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return Number.NaN
}
