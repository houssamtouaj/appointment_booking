import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'

import { isApiError } from '@/api/error'
import { roleSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Modal } from '@/components/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { FormAlert } from '@/components/form-alert'
import { lastOwnerReason, LAST_OWNER_COPY } from '@/features/staff/staff-state'
import { useUpdateStaff } from '@/features/staff/team-queries'
import type { Role, Staff } from '@/types'
import { useTranslation, type TKey } from '@/i18n'

/**
 * Name and role. Deactivation is not here — it is on the row.
 *
 * `UpdateStaffRequest` carries all three fields and this dialog deliberately
 * offers two of them. Deactivating somebody is not an edit to be saved alongside
 * a spelling correction: it revokes their sessions, it can produce a warning the
 * screen has to keep on display, and it is undone by a different button in a
 * different place. Mixing it into a form with a Cancel button would make "Cancel"
 * ambiguous about something irreversible-feeling.
 *
 * The patch sent is only what changed, for the reason
 * `services/service-form.ts` gives at length: absent means *leave it alone* and
 * `null` is a 422, and React Hook Form is happy to hand back an unchanged field.
 */

type StaffFormValues = {
  fullName: string
  role: Role
}

const staffFormSchema = z.object({
  // Keys, not sentences: this schema is built at module scope, so a sentence
  // would be captured in whatever language the tab was loaded in and would then
  // survive a switch. The render resolves them.
  fullName: z
    .string()
    .trim()
    .min(1, 'team.edit.nameRequired' satisfies TKey)
    .max(120, 'team.edit.nameTooLong' satisfies TKey),
  role: roleSchema,
})

type StaffEditDialogProps = {
  person: Staff
  /** The whole roster, for the last-owner guard. */
  team: readonly Staff[]
  onClose: () => void
}

export function StaffEditDialog({ person, team, onClose }: StaffEditDialogProps) {
  const { t } = useTranslation()
  const update = useUpdateStaff()

  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: { fullName: person.fullName, role: person.role },
  })

  const { alert, reportFailure, clear } = useFormErrorSummary(form)

  /** Set when demoting this person would leave the business ownerless. */
  const cannotDemote = lastOwnerReason(person, team)

  function submit(values: StaffFormValues) {
    clear()

    const patch: { fullName?: string; role?: Role } = {}
    const fullName = values.fullName.trim()
    if (fullName !== person.fullName) patch.fullName = fullName
    if (values.role !== person.role) patch.role = values.role

    // Nothing moved. A `PATCH {}` is legal and would cost a round trip and two
    // cache invalidations to answer with the row that is already on screen.
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }

    update.mutate(
      { id: person.id, request: patch },
      {
        onSuccess: (result) => {
          toast.success(`${result.staff.fullName} is updated.`, {
            // A role change is not instant, and pretending otherwise produces a
            // support question. The target's current access token carries the old
            // role until it is refreshed, which the backend documents rather than
            // papers over.
            description: patch.role !== undefined ? t('team.edit.roleDelay') : undefined,
          })
          onClose()
        },
        onError: (error) => {
          if (isApiError(error, 'LAST_OWNER')) {
            form.setError(
              'role',
              { type: 'server', message: LAST_OWNER_COPY },
              { shouldFocus: true },
            )
            clear()
            return
          }

          reportFailure(error, { copy: { VALIDATION_FAILED: 'errors.checkTheName' } })
        },
      },
    )
  }

  const errors = form.formState.errors

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !update.isPending) onClose()
      }}
      title={t('team.edit.title')}
      description={t('team.edit.description', { email: person.email })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="staff-form" disabled={update.isPending}>
            {update.isPending ? t('team.edit.saving') : t('team.edit.save')}
          </Button>
        </>
      }
    >
      {alert ? <FormAlert {...alert} /> : null}

      <form id="staff-form" noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-5">
        <FormField
          label={t('team.edit.fullName')}
          error={errors.fullName?.message ? t(errors.fullName.message as TKey) : undefined}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('fullName')}
              autoComplete="name"
              data-first-field
            />
          )}
        </FormField>

        <FormField
          label={t('team.invite.role')}
          hint={cannotDemote ?? t('team.invite.roleHint')}
          error={errors.role?.message}
        >
          {(control) => (
            <select
              {...control}
              {...form.register('role')}
              // Disabled rather than left to fail: the only active owner cannot
              // be demoted, the API answers `409 LAST_OWNER`, and being told
              // before pressing the button is better than after. The hint above
              // carries the reason, and `FormField` has already wired it into
              // `aria-describedby` — so the explanation reaches a screen reader
              // and not only a pointer.
              disabled={cannotDemote !== undefined}
              className="border-input bg-card text-foreground h-9 w-full rounded-sm border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="STAFF">{t('team.invite.roleStaff')}</option>
              <option value="OWNER">{t('team.invite.roleOwner')}</option>
            </select>
          )}
        </FormField>
      </form>
    </Modal>
  )
}
