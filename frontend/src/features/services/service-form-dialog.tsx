import { zodResolver } from '@hookform/resolvers/zod'
import { TriangleAlert } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { applyFieldErrors, isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import {
  MAX_BUFFER_MINUTES,
  SERVICE_MAX_MINUTES,
  SERVICE_MIN_MINUTES,
  SERVICE_STEP_MINUTES,
} from '@/api/schemas/catalog'
import { FormField } from '@/components/form-field'
import { Modal } from '@/components/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { FormAlert } from '@/features/auth/form-alert'
import { useCreateService, useUpdateService } from '@/features/services/catalog-queries'
import {
  emptyServiceForm,
  isNoChange,
  serviceFormSchema,
  serviceFormValues,
  toCreateRequest,
  totalBlockPreview,
  toUpdatePatch,
  type ServiceFormValues,
} from '@/features/services/service-form'
import type { Lookups } from '@/hooks/use-lookups'
import { currencyDigits } from '@/lib/money'
import { formatDuration } from '@/lib/time'
import { cn } from '@/lib/utils'
import type { Service, Staff, ValidationError } from '@/types'

/**
 * One dialog for create and for edit, because there is one service.
 *
 * The two request bodies are genuinely different — `ServiceRequest` requires a
 * name, a duration and a price; `ServiceUpdateRequest` is a patch where every
 * field is optional — but that difference is a property of what gets *sent*, not
 * of what gets *asked*, and it lives in `service-form.ts` where the two builders
 * are. A second dialog would duplicate eight fields, the buffer explanation, the
 * live block preview and the staff picker in order to vary one function call.
 *
 * Three things here are the wave's decisions rather than layout:
 *
 * - **The price is a string all the way to `toMinorUnits`.** No `double` is ever
 *   made out of a price. See `lib/money.ts`.
 * - **Saving an active service with nobody assigned warns first**, and then
 *   allows it. Refusing would be a rule the API does not have — the endpoint
 *   documents that omitting `staffIds` is legal and returns `bookable: false` —
 *   and this screen's whole argument is that the state is legitimate and should
 *   be *visible*, not impossible.
 * - **Editing a price says, once, that existing bookings are safe.** Bookings
 *   snapshot their terms (backend D14), and it is the question an owner will
 *   hesitate over before they touch the field.
 */

type ServiceFormDialogProps = {
  /** The service being edited, or `undefined` to create one. */
  service?: Service
  lookups: Lookups
  currency: string
  onClose: () => void
}

export function ServiceFormDialog({ service, lookups, currency, onClose }: ServiceFormDialogProps) {
  const editing = service !== undefined
  const staffFieldId = useId()

  const create = useCreateService()
  const update = useUpdateService()
  const pending = create.isPending || update.isPending

  const [alert, setAlert] = useState<{
    message: string
    unmatched: ValidationError[]
    requestId?: string
  } | null>(null)
  /**
   * True once the person has been shown the "nobody can perform this" warning.
   * It gates the panel, not the save: the save is gated by which button was
   * pressed, so a warning that appears cannot be bypassed by pressing Enter.
   */
  const [warnedAboutStaff, setWarnedAboutStaff] = useState(false)

  const form = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceFormSchema),
    defaultValues: service ? serviceFormValues(service, currency) : emptyServiceForm(),
  })

  /**
   * `useWatch` and not `form.watch()`. The latter returns a fresh function on
   * every render, which React Compiler cannot memoise and warns about; `useWatch`
   * is a hook and subscribes to the three fields the preview and the staff
   * warning actually depend on, rather than re-rendering the dialog on every
   * keystroke in the description.
   */
  const staffIds = useWatch({ control: form.control, name: 'staffIds' }) ?? []
  const durationMinutes = useWatch({ control: form.control, name: 'durationMinutes' }) ?? ''
  const bufferBeforeMinutes = useWatch({ control: form.control, name: 'bufferBeforeMinutes' }) ?? ''
  const bufferAfterMinutes = useWatch({ control: form.control, name: 'bufferAfterMinutes' }) ?? ''

  const blockMinutes = totalBlockPreview({
    durationMinutes,
    bufferBeforeMinutes,
    bufferAfterMinutes,
  })

  /**
   * Would saving this leave a service that is on sale and unperformable?
   *
   * An **archived** service with nobody assigned is not a problem — it offers
   * nothing because it is switched off, which is what the owner asked for. A new
   * service is always created active, so creating counts.
   */
  const wouldBeSilentlyUnbookable = staffIds.length === 0 && (!editing || service.active)
  const showStaffWarning = warnedAboutStaff && wouldBeSilentlyUnbookable

  /**
   * Bring the panel into view when it appears.
   *
   * The Save button lives in the dialog's footer and the panel is at the bottom
   * of a body that scrolls independently of it, so on a phone — or on any
   * viewport shorter than eight fields — the first press would set this state
   * and change nothing the person can see. A submit button that appears to do
   * nothing is the one outcome this warning must not have.
   *
   * Optional-called because jsdom has no layout engine and does not implement
   * `scrollIntoView`; there is nothing for it to do under test, and nothing here
   * that should fail because of that.
   */
  const staffWarning = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showStaffWarning) return
    staffWarning.current?.scrollIntoView?.({ block: 'nearest' })
  }, [showStaffWarning])

  function save(formValues: ServiceFormValues, options?: { acceptNoStaff?: boolean }) {
    if (wouldBeSilentlyUnbookable && !options?.acceptNoStaff) {
      setWarnedAboutStaff(true)
      return
    }
    setAlert(null)

    if (!editing) {
      create.mutate(toCreateRequest(formValues, currency), {
        onSuccess: (created) => {
          toast.success(
            created.bookable
              ? `${created.name} is on your booking page.`
              : `${created.name} is saved. It is not bookable yet — nobody is assigned to it.`,
          )
          onClose()
        },
        onError: reportFailure,
      })
      return
    }

    const patch = toUpdatePatch(formValues, service, currency)
    // A `PATCH {}` is legal and answers 200 with the service unchanged, which
    // would be a round trip plus two cache invalidations plus a refetch of the
    // whole reference layer, to accomplish nothing.
    if (isNoChange(patch)) {
      onClose()
      return
    }

    update.mutate(
      { id: service.id, request: patch },
      {
        onSuccess: (saved) => {
          toast.success(`${saved.name} is updated.`)
          onClose()
        },
        onError: reportFailure,
      },
    )
  }

  function reportFailure(error: unknown) {
    // The one code that belongs on a specific field. It carries the offending
    // ids as a problem member, but the useful thing to say is not which id — an
    // owner never saw one — it is that the picker is out of date, which happens
    // when somebody else removed a colleague while this dialog sat open.
    if (isApiError(error, 'STAFF_NOT_IN_BUSINESS')) {
      form.setError('staffIds', {
        type: 'server',
        message:
          'One of those colleagues is no longer part of this business. Reload the page and pick again.',
      })
      setAlert(null)
      return
    }

    const unmatched = applyFieldErrors(error, form)
    setAlert({
      message: describeError(error, {
        VALIDATION_FAILED: 'Some of these details need fixing.',
      }),
      unmatched,
      requestId: requestIdOf(error),
    })
  }

  const errors = form.formState.errors
  const priceStep = stepFor(currency)

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose()
      }}
      title={editing ? 'Edit service' : 'New service'}
      description={
        editing
          ? `What ${service.name} is, how long it takes and who performs it.`
          : 'What you sell, how long it takes and who performs it.'
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="service-form" disabled={pending}>
            {pending ? 'Saving…' : editing ? 'Save changes' : 'Create service'}
          </Button>
        </>
      }
    >
      {alert ? (
        <FormAlert
          message={alert.message}
          unmatched={alert.unmatched}
          requestId={alert.requestId}
        />
      ) : null}

      <form
        id="service-form"
        noValidate
        onSubmit={form.handleSubmit((formValues) => save(formValues))}
        className="grid gap-5"
      >
        <FormField label="Name" error={errors.name?.message}>
          {(control) => (
            <Input {...control} {...form.register('name')} autoComplete="off" data-first-field />
          )}
        </FormField>

        <FormField
          label="Description"
          hint="Shown to customers on your booking page. Optional."
          error={errors.description?.message}
        >
          {(control) => <Textarea {...control} {...form.register('description')} rows={3} />}
        </FormField>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            label="Duration"
            hint={`In minutes. ${SERVICE_MIN_MINUTES}–${SERVICE_MAX_MINUTES}, in steps of ${SERVICE_STEP_MINUTES}.`}
            error={errors.durationMinutes?.message}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('durationMinutes')}
                type="number"
                inputMode="numeric"
                min={SERVICE_MIN_MINUTES}
                max={SERVICE_MAX_MINUTES}
                step={SERVICE_STEP_MINUTES}
              />
            )}
          </FormField>

          <FormField
            // The currency is the *business's* and is in the label rather than
            // as a symbol glued to the input: `Intl` puts the symbol before or
            // after the number depending on who is reading, and an input cannot
            // be punctuated two ways.
            label={`Price (${currency})`}
            hint={
              editing
                ? 'Existing bookings keep the price they were taken at. Changing this only affects new ones.'
                : undefined
            }
            error={errors.price?.message}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('price')}
                type="number"
                inputMode="decimal"
                min={0}
                step={priceStep}
                placeholder={priceStep}
              />
            )}
          </FormField>
        </div>

        <fieldset className="grid gap-3">
          <legend className="text-foreground text-sm font-medium">Buffers</legend>
          <p className="text-muted-foreground -mt-1 text-xs">
            Setup and cleanup time. Blocks the calendar, is not charged, and is what stops the next
            appointment starting too early.
          </p>

          <div className="grid gap-5 sm:grid-cols-2">
            <FormField label="Before" error={errors.bufferBeforeMinutes?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('bufferBeforeMinutes')}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_BUFFER_MINUTES}
                  step={SERVICE_STEP_MINUTES}
                  placeholder="0"
                />
              )}
            </FormField>
            <FormField label="After" error={errors.bufferAfterMinutes?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('bufferAfterMinutes')}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_BUFFER_MINUTES}
                  step={SERVICE_STEP_MINUTES}
                  placeholder="0"
                />
              )}
            </FormField>
          </div>

          {/* The live total, matching `totalBlockMinutes` on the response. A
              `status` region so it is announced when it changes, rather than
              being a number that silently moves for anyone not watching it. */}
          <p role="status" className="text-muted-foreground text-xs">
            {blockMinutes === undefined
              ? 'Enter a duration to see how much of the calendar one appointment takes.'
              : `One appointment blocks ${formatDuration(blockMinutes)} of the calendar.`}
          </p>
        </fieldset>

        <StaffPicker
          fieldId={staffFieldId}
          lookups={lookups}
          selected={staffIds}
          error={errors.staffIds?.message}
          onToggle={(id, on) =>
            form.setValue(
              'staffIds',
              on ? [...staffIds, id] : staffIds.filter((current) => current !== id),
              { shouldDirty: true },
            )
          }
        />

        {showStaffWarning ? (
          <div
            ref={staffWarning}
            role="alert"
            className="border-warning/50 bg-warning-wash text-foreground rounded-sm border px-3 py-3 text-sm"
          >
            <p className="flex items-start gap-2 font-medium">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Nobody is assigned to perform this
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              It will be listed on your booking page and offer no times at all, with nothing on the
              page to say why. Tick a colleague above, or save it anyway and fix it from the row.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={pending}
              onClick={form.handleSubmit((formValues) => save(formValues, { acceptNoStaff: true }))}
            >
              Save without anyone assigned
            </Button>
          </div>
        ) : null}
      </form>
    </Modal>
  )
}

/**
 * `"0.01"` for EUR, `"1"` for JPY, `"0.001"` for BHD.
 *
 * The input's `step` and its placeholder. Without it the browser's default step
 * of 1 makes the arrows jump a whole euro and marks `12.50` as invalid, which is
 * a validation message about a price that is perfectly fine.
 */
function stepFor(currency: string): string {
  const digits = currencyDigits(currency)
  return digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`
}

/**
 * Who performs it — a checkbox per colleague, and **deactivated ones are shown**.
 *
 * Not filtered to the active team, which would be the obvious thing and would
 * hide an assignment that is the reason a service is unbookable: a service whose
 * only performer has left shows an empty picker, the owner ticks somebody, and
 * the departed colleague stays assigned forever with no screen admitting it.
 * They are listed last and marked, so the set on screen is the set that will be
 * sent — which matters because `staffIds` replaces the whole thing.
 *
 * A native fieldset of checkboxes rather than a combobox. It is a short list, the
 * platform control is already keyboard- and screen-reader-complete, and a
 * multi-select listbox is the single most commonly broken custom widget there is.
 */
function StaffPicker({
  fieldId,
  lookups,
  selected,
  error,
  onToggle,
}: {
  fieldId: string
  lookups: Lookups
  selected: readonly string[]
  error?: string
  onToggle: (staffId: string, on: boolean) => void
}) {
  const team = orderedTeam(lookups)
  const errorId = `${fieldId}-error`

  return (
    <fieldset aria-describedby={error ? errorId : undefined}>
      <legend className="text-foreground text-sm font-medium">Who performs it</legend>
      <p className="text-muted-foreground mt-1 text-xs">
        A service with nobody assigned offers no times, however it is priced.
      </p>

      {team.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">
          {lookups.isLoading ? 'Loading your team…' : 'You have not invited anyone yet.'}
        </p>
      ) : (
        <ul className="mt-3 grid gap-1">
          {team.map((person) => {
            const id = `${fieldId}-${person.id}`
            const checked = selected.includes(person.id)
            return (
              <li key={person.id}>
                <div
                  className={cn(
                    'flex items-center gap-2.5 rounded-sm px-2 py-1.5',
                    checked && 'bg-primary-wash',
                  )}
                >
                  <input
                    id={id}
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onToggle(person.id, event.target.checked)}
                    className="accent-primary size-4 shrink-0"
                  />
                  <Label htmlFor={id} className="flex-1 truncate font-normal">
                    {person.fullName}
                    {person.active ? null : (
                      <span className="text-muted-foreground"> · deactivated</span>
                    )}
                  </Label>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      ) : null}
    </fieldset>
  )
}

/** Active first, each half alphabetical — so the useful half is at the top. */
function orderedTeam(lookups: Lookups): Staff[] {
  return [...lookups.staffById.values()].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1
    return a.fullName.localeCompare(b.fullName)
  })
}
