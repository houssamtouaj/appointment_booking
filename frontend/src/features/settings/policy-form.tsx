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

const SCHEMA = z.object({
  minLeadTimeHours: z.coerce
    .number<number>()
    .int('Whole hours only')
    .min(0, 'Between 0 and 168')
    .max(168, 'Between 0 and 168'),
  maxAdvanceDays: z.coerce
    .number<number>()
    .int('Whole days only')
    .min(1, 'Between 1 and 365')
    .max(365, 'Between 1 and 365'),
  cancellationCutoffHours: z.coerce
    .number<number>()
    .int('Whole hours only')
    .min(0, 'Between 0 and 168')
    .max(168, 'Between 0 and 168'),
  slotGranularityMinutes: z.coerce.number<number>().pipe(z.literal(SLOT_GRANULARITIES)),
})

type PolicyFormValues = z.input<typeof SCHEMA>

export function PolicyForm({ policy }: { policy: Policy }) {
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
        toast.success('Your booking rules are saved.', { description: describePolicy(saved) })
      },
      onError: (error) => {
        reportFailure(error, {
          copy: {
            VALIDATION_FAILED: 'Check the numbers marked below.',
            ACCESS_DENIED: 'Only an owner can change the booking rules.',
          },
        })
      },
    })
  }

  const errors = form.formState.errors

  return (
    <section aria-labelledby="booking-policy" className="mt-12">
      <h2 id="booking-policy" className="font-display text-foreground text-lg">
        Booking rules
      </h2>

      <form noValidate onSubmit={form.handleSubmit(submit)} className="max-w-copy mt-4 grid gap-5">
        {alert ? <FormAlert {...alert} /> : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Minimum notice (hours)"
            hint={POLICY_HINTS.minLeadTimeHours}
            error={errors.minLeadTimeHours?.message}
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
            label="Booking window (days)"
            hint={POLICY_HINTS.maxAdvanceDays}
            error={errors.maxAdvanceDays?.message}
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
            label="Cancellation cutoff (hours)"
            hint={POLICY_HINTS.cancellationCutoffHours}
            error={errors.cancellationCutoffHours?.message}
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
            label="Slot step"
            hint={POLICY_HINTS.slotGranularityMinutes}
            error={errors.slotGranularityMinutes?.message}
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
            <p className="text-muted-foreground text-sm">
              Fill in all four numbers to see what customers will be offered.
            </p>
          )}
        </div>

        {/* Correct, and worth saying once: the API allows it and does not move
            anything, so a warning implying otherwise would be inventing a
            consequence. */}
        <p className="text-muted-foreground text-xs">
          Changing the slot step does not move appointments that are already booked. Some may sit
          off the new grid, which is expected.
        </p>

        <div className="flex justify-end">
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending ? 'Saving…' : 'Save booking rules'}
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
