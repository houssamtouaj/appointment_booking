import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'

import { isApiError } from '@/api/error'
import { inviteStaffRequestSchema } from '@/api/schemas/staff'
import { FormField } from '@/components/form-field'
import { Modal } from '@/components/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { FormAlert } from '@/components/form-alert'
import { useInviteStaff } from '@/features/staff/team-queries'
import { IS_DEV } from '@/lib/env'
import type { InviteStaffRequest, Staff } from '@/types'
import { useTranslation, type TKey } from '@/i18n'

/**
 * "Invite a colleague" — and then, in words, what that actually did.
 *
 * The dialog does not close on success. That is deliberate: an invitation is the
 * one action on these two screens whose result happens *somewhere else*, in
 * somebody's inbox, and the row it adds to the roster says "Invited" without
 * saying what the invited person is now supposed to do. So the dialog switches to
 * a panel that explains the mechanism — a link, seven days, they choose their own
 * password, no password is set here — because the owner is the person who will be
 * asked about it.
 *
 * It also keeps the address on screen, which matters more than it sounds: a typo
 * in an email address produces a perfectly successful invitation that nobody ever
 * receives, and the only moment it can be caught is now.
 */

type InviteDialogProps = {
  onClose: () => void
}

export function InviteDialog({ onClose }: InviteDialogProps) {
  const { t } = useTranslation()
  const invite = useInviteStaff()
  /** The colleague the API created, once it has. Switches the dialog's body. */
  const [invited, setInvited] = useState<Staff | null>(null)

  const form = useForm<InviteStaffRequest>({
    resolver: zodResolver(inviteStaffRequestSchema),
    defaultValues: { fullName: '', email: '', role: 'STAFF' },
  })

  const { alert, reportFailure, clear } = useFormErrorSummary(form)

  function submit(values: InviteStaffRequest) {
    clear()
    invite.mutate(values, {
      onSuccess: (person) => setInvited(person),
      onError: (error) => {
        // The one 409 this endpoint has, and "conflict" is the wrong word for
        // it. It means the address already has an account *anywhere in the
        // product*, not that it is already on this team — one human cannot own
        // two businesses in v1 (backend D13). An owner needs to be told that
        // rather than left retrying the same address.
        if (isApiError(error, 'EMAIL_TAKEN')) {
          form.setError(
            'email',
            {
              type: 'server',
              message: t('team.invite.emailTaken'),
            },
            { shouldFocus: true },
          )
          clear()
          return
        }

        reportFailure(error, { copy: { VALIDATION_FAILED: 'errors.checkAddressAndName' } })
      },
    })
  }

  const errors = form.formState.errors

  if (invited) {
    return (
      <Modal
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
        title={t('team.invite.sentTitle')}
        description={t('team.invite.sentDescription', {
          name: invited.fullName,
          role: t(roleWord(invited.role)),
        })}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                // A second invitation, from the same dialog. Onboarding a salon
                // is three or four people in a row, and closing and reopening
                // between each is the interface being tidy at the user's expense.
                setInvited(null)
                form.reset({ fullName: '', email: '', role: invited.role })
              }}
            >
              {t('team.invite.inviteAnother')}
            </Button>
            <Button onClick={onClose}>{t('common.done')}</Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <span className="bg-success-wash text-success inline-flex size-9 shrink-0 items-center justify-center rounded-sm">
            <MailCheck className="size-5" aria-hidden="true" />
          </span>
          <div className="text-sm">
            <p className="text-foreground">{t('team.invite.sentBody', { email: invited.email })}</p>
            <p className="text-muted-foreground mt-2">{t('team.invite.sentPassword')}</p>
            {IS_DEV ? (
              <p className="text-muted-foreground border-rule mt-3 border-t pt-3 text-xs">
                {t('team.invite.sentDevNote', { host: 'localhost:8025' })}
              </p>
            ) : null}
          </div>
        </div>
      </Modal>
    )
  }

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next && !invite.isPending) onClose()
      }}
      title={t('team.invite.title')}
      description={t('team.invite.description')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={invite.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="invite-form" disabled={invite.isPending}>
            {invite.isPending ? t('team.invite.sending') : t('team.invite.send')}
          </Button>
        </>
      }
    >
      {alert ? <FormAlert {...alert} /> : null}

      <form id="invite-form" noValidate onSubmit={form.handleSubmit(submit)} className="grid gap-5">
        <FormField label={t('team.invite.fullName')} error={errors.fullName?.message}>
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
          label={t('team.invite.email')}
          hint={t('team.invite.emailHint')}
          error={errors.email?.message}
        >
          {(control) => (
            <Input {...control} {...form.register('email')} type="email" autoComplete="email" />
          )}
        </FormField>

        <FormField
          label={t('team.invite.role')}
          hint={t('team.invite.roleHint')}
          error={errors.role?.message}
        >
          {(control) => (
            // A native select: two options, and the platform control is already
            // keyboard-complete and opens the operating system's own picker on a
            // phone.
            <select
              {...control}
              {...form.register('role')}
              className="border-input bg-card text-foreground h-9 w-full rounded-sm border px-3 text-sm"
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

/** "an owner" / "a staff member" — for the middle of a sentence. */
function roleWord(role: Staff['role']): TKey {
  return role === 'OWNER' ? 'team.invite.roleWordOwner' : 'team.invite.roleWordStaff'
}
