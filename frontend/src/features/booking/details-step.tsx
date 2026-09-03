import { ChevronLeft } from 'lucide-react'
import type { UseFormReturn } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { BookingSummary } from '@/features/booking/booking-summary'
import type { GuestDetails, PublicBusiness, PublicService } from '@/types'
import { useTranslation } from '@/i18n'

type DetailsStepProps = {
  /**
   * Owned by `BookingFlowPage`, not by this component.
   *
   * That is the whole answer to the gate item about a `409` preserving what was
   * typed: this step unmounts when the flow returns to the picker, and a form
   * declared here would go with it. Declared one level up, it simply stays.
   */
  form: UseFormReturn<GuestDetails>
  business: PublicBusiness
  service: PublicService
  /** "Anyone", or the person chosen. Absent while the roster is still loading. */
  staffName?: string
  /** The chosen slot's `start`, verbatim from the availability response. */
  startsAt: string
  submitting: boolean
  onSubmit: (values: GuestDetails) => void
  /** Back to the picker, keeping the week. */
  backHref: string
}

/**
 * Step 4 — who is coming, and the last chance to notice the wrong slot.
 *
 * The summary sits **above** the fields rather than beside the button, because
 * the mistake it catches is made three screens earlier: a customer who tapped
 * the wrong chip in a grid of ninety-eight has no other opportunity to find out.
 */
export function DetailsStep({
  form,
  business,
  service,
  staffName,
  startsAt,
  submitting,
  onSubmit,
  backHref,
}: DetailsStepProps) {
  const { t } = useTranslation()
  const errors = form.formState.errors

  return (
    <div className="space-y-6">
      <BookingSummary
        serviceName={service.name}
        durationMinutes={service.durationMinutes}
        staffName={staffName}
        startsAt={startsAt}
        timeZone={business.timezone}
        priceCents={service.priceCents}
        currency={business.currency}
      />

      <Link
        to={backHref}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        {t('booking.details.back')}
      </Link>

      <form noValidate className="grid gap-4" onSubmit={form.handleSubmit(onSubmit)}>
        <FormField label={t('booking.details.name')} error={errors.guestName?.message}>
          {(control) => <Input {...control} {...form.register('guestName')} autoComplete="name" />}
        </FormField>

        <FormField
          label={t('booking.details.email')}
          hint={t('booking.details.emailHint')}
          error={errors.guestEmail?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('guestEmail')}
              type="email"
              autoComplete="email"
              // `inputMode` as well as `type`: iOS decides the keyboard from the
              // type, Android reads this, and a numeric keypad in front of an
              // address is how the @ ends up missing.
              inputMode="email"
            />
          )}
        </FormField>

        <FormField label={t('booking.details.phone')} error={errors.guestPhone?.message}>
          {(control) => (
            <Input {...control} {...form.register('guestPhone')} type="tel" autoComplete="tel" />
          )}
        </FormField>

        <FormField
          label={t('booking.details.notes')}
          error={errors.notes?.message}
          hint={t('booking.details.notesHint')}
        >
          {(control) => <Textarea {...control} {...form.register('notes')} rows={3} />}
        </FormField>

        <DepositSentence business={business} />

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? t('booking.details.submitting') : t('booking.details.submit')}
          </Button>
        </div>
      </form>
    </div>
  )
}

/**
 * The deposit sentence, and it promises nothing (F5).
 *
 * This screen **cannot** know whether a deposit will be taken. The server
 * decides it with `payments.enabled() && business.requiresDeposit()`, and only
 * the second half of that is on any public payload — the demo reports
 * `depositRequired: true` and then confirms every booking with no deposit taken,
 * because payments are off. So the copy says what is knowable and lets the
 * response decide, which is the same rule the landing page follows and a gate
 * item on both.
 *
 * Rendered only when the business has a deposit setting at all. A business that
 * never asks for one has nothing to warn about, and a paragraph about a
 * hypothetical checkout above the confirm button is a reason to hesitate that
 * this screen did not need to invent.
 */
function DepositSentence({ business }: { business: PublicBusiness }) {
  const { t } = useTranslation()
  if (!business.depositRequired) return null

  return (
    <p className="bg-muted text-muted-foreground rounded-sm px-3 py-2 text-sm">
      {business.depositPercent
        ? t('booking.details.depositMaybePercent', { percent: business.depositPercent })
        : t('booking.details.depositMaybe')}
    </p>
  )
}
