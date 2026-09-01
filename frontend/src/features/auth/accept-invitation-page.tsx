import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { acceptInvitation, authKeys, fetchInvitation } from '@/api/auth'
import { applyFieldErrors, isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { acceptInvitationRequestSchema } from '@/api/schemas/invitation'
import { ErrorState } from '@/components/error-state'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/components/form-alert'
import type { AcceptInvitationRequest, ValidationError } from '@/types'

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
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [alert, setAlert] = useState<{
    message: string
    unmatched: ValidationError[]
    requestId?: string
  } | null>(null)

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

  const accept = useMutation({
    mutationFn: (values: AcceptInvitationRequest) => acceptInvitation(token, values),
    onSuccess: () => {
      // 204 and no session: accepting sets a password, it does not sign anyone
      // in. Sending them to the login screen with their new password is the
      // shortest honest path.
      toast.success('Your account is ready. Sign in with your new password.')
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      setAlert({
        message: describeError(error, {
          INVITATION_CONSUMED: 'This invitation has already been used or has expired.',
        }),
        unmatched: applyFieldErrors(error, form),
        requestId: requestIdOf(error),
      })
    },
  })

  if (invitation.isPending) {
    return (
      <AuthLayout eyebrow="Account" title="Join the team">
        <span className="sr-only" role="status">
          Loading the invitation
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
      <AuthLayout eyebrow="Account" title="Join the team">
        <ErrorState
          title={
            consumed ? 'This invitation has already been used' : 'This invitation is not valid'
          }
          description={
            consumed
              ? 'Invitations work once and expire after seven days. Ask an owner of the business to send a new one.'
              : describeError(invitation.error, {
                  NOT_FOUND:
                    'We do not recognise this link. Check that you copied the whole address from the email.',
                })
          }
          requestId={requestIdOf(invitation.error)}
        />
        <p className="mt-6 text-center text-sm">
          <Link to="/login" className="text-primary underline underline-offset-4">
            Go to log in
          </Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      eyebrow="Account"
      title="Join the team"
      description={
        <>
          <span className="text-foreground font-medium">{invitation.data.businessName}</span>{' '}
          invited <span className="text-foreground">{invitation.data.email}</span>. Choose a
          password to activate the account.
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
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => accept.mutate(values))}
      >
        <FormField label="Your name" error={form.formState.errors.fullName?.message}>
          {(control) => <Input {...control} {...form.register('fullName')} autoComplete="name" />}
        </FormField>

        <FormField
          label="Password"
          hint="At least 8 characters."
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
          {accept.isPending ? 'Joining…' : 'Join the team'}
        </Button>
      </form>
    </AuthLayout>
  )
}
