import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { acceptInvitation, authKeys, fetchInvitation } from '@/api/auth'
import { isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { acceptInvitationRequestSchema } from '@/api/schemas/invitation'
import { ErrorState } from '@/components/error-state'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/components/form-alert'
import type { AcceptInvitationRequest } from '@/types'
import { useTranslation } from '@/i18n'

/**
 * `/accept-invitation/:token` — another route the backend names (F12).
 *
 * The preview request comes first, and it is what makes this a page rather than
 * a form. `GET /api/public/invitations/{token}` returns the business name and
 * the invited address, so the screen can say *which* business is inviting *which
 * address* — both things the recipient of the email already knows, which is what
 * makes them safe to return for a bare token, and both things whose absence
 * would make this indistinguishable from a phishing page.
 *
 * It is also where `410 INVITATION_CONSUMED` gets handled as an explanation
 * rather than as a crash: an invitation used yesterday is the most likely way
 * anyone arrives here twice.
 */
export function AcceptInvitationPage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const navigate = useNavigate()

  const invitation = useQuery({
    queryKey: authKeys.invitation(token),
    queryFn: () => fetchInvitation(token),
    // A consumed or unknown token is not going to become valid; the query
    // client's default already refuses to retry a 4xx, and this says so locally
    // because it is the whole behaviour of the screen.
    retry: false,
  })

  const form = useForm<AcceptInvitationRequest>({
    resolver: zodResolver(acceptInvitationRequestSchema),
    defaultValues: { fullName: '', password: '' },
  })

  const { alert, reportFailure } = useFormErrorSummary(form)

  const accept = useMutation({
    mutationFn: (values: AcceptInvitationRequest) => acceptInvitation(token, values),
    onSuccess: () => {
      // 204 and no session: accepting sets a password, it does not sign anyone
      // in. Sending them to the login screen with their new password is the
      // shortest honest path.
      toast.success(t('auth.invitation.done'))
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      reportFailure(error, {
        messageFor: { fullName: 'errors.fieldName', password: 'errors.fieldPassword' },
        copy: { INVITATION_CONSUMED: 'errors.invitationSpent' },
      })
    },
  })

  if (invitation.isPending) {
    return (
      <AuthLayout eyebrow={t('auth.eyebrow')} title={t('auth.invitation.title')}>
        <span className="sr-only" role="status">
          {t('auth.invitation.loading')}
        </span>
        <Skeleton className="h-16 w-full" />
        <Skeleton className="mt-4 h-9 w-full" />
        <Skeleton className="mt-4 h-9 w-full" />
      </AuthLayout>
    )
  }

  if (invitation.isError) {
    const consumed = isApiError(invitation.error, 'INVITATION_CONSUMED')
    return (
      <AuthLayout eyebrow={t('auth.eyebrow')} title={t('auth.invitation.title')}>
        <ErrorState
          title={consumed ? t('auth.invitation.consumedTitle') : t('auth.invitation.invalidTitle')}
          description={
            consumed
              ? t('auth.invitation.consumedBody')
              : describeError(invitation.error, {
                  NOT_FOUND: 'errors.invitationUnrecognised',
                })
          }
          requestId={requestIdOf(invitation.error)}
        />
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-primary underline underline-offset-4">
            {t('auth.invitation.goToLogin')}
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      eyebrow={t('auth.eyebrow')}
      title={t('auth.invitation.title')}
      // One key with two placeholders rather than three fragments joined in JSX:
      // French does not put the verb where English does, and a joined string
      // cannot express that. The cost is losing the two emphasis spans, which
      // was decoration on a sentence that names both values anyway.
      description={t('auth.invitation.invitedBy', {
        business: invitation.data.businessName,
        email: invitation.data.email,
      })}
    >
      {alert ? <FormAlert {...alert} /> : null}

      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => accept.mutate(values))}
      >
        <FormField
          label={t('auth.invitation.fullName')}
          error={form.formState.errors.fullName?.message}
        >
          {(control) => <Input {...control} {...form.register('fullName')} autoComplete="name" />}
        </FormField>

        <FormField
          label={t('auth.invitation.password')}
          hint={t('auth.invitation.passwordHint')}
          error={form.formState.errors.password?.message}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('password')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={accept.isPending}>
          {accept.isPending ? t('auth.invitation.submitting') : t('auth.invitation.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
