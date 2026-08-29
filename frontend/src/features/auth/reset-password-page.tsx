import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { resetPassword } from '@/api/auth'
import { applyFieldErrors } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { passwordSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/features/auth/form-alert'
import type { ValidationError } from '@/types'
import { z } from 'zod'

/**
 * `/reset-password/:token` — a route named by the backend (F12). `FrontendLinks`
 * builds it into outbound mail, so a link sitting in an inbox from three weeks
 * ago still has to resolve here.
 *
 * The token is not shown and not editable. It arrives in the path, goes back in
 * the request body, and the only thing the person types is the new password.
 */
const formSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  // Confirmation is a client-side idea — the API takes one password. It is here
  // because this is the one form in the app where a typo cannot be corrected by
  // trying again: the token is single-use, so a mistyped password means asking
  // for a second email.
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'The two passwords do not match',
  })

type FormValues = z.infer<typeof formSchema>

export function ResetPasswordPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [alert, setAlert] = useState<{
    message: string
    unmatched: ValidationError[]
    requestId?: string
  } | null>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  })

  const submit = useMutation({
    mutationFn: (values: FormValues) => resetPassword({ token, password: values.password }),
    onSuccess: () => {
      toast.success('Your password was changed. Sign in with it.')
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      setAlert({
        message: describeError(error, {
          // The single shape this endpoint fails in that is worth its own
          // sentence: the token is spent, expired, or was never ours. The API
          // does not distinguish between them and neither should this.
          VALIDATION_FAILED: 'That link is no longer valid. Ask for a new one.',
          NOT_FOUND: 'That link is no longer valid. Ask for a new one.',
        }),
        // The server's `errors[]` names `password`, which this form has, and
        // `token`, which it does not — so the token message comes back unmatched
        // and lands in the banner rather than disappearing.
        unmatched: applyFieldErrors(error, form),
        requestId: requestIdOf(error),
      })
    },
  })

  return (
    <AuthLayout
      eyebrow="Account"
      title="Choose a new password"
      description="Setting it signs you out everywhere else — that is what a reset is for."
      footer={
        <>
          Link expired?{' '}
          <Link to="/forgot-password" className="text-primary underline underline-offset-4">
            Ask for a new one
          </Link>
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
        onSubmit={form.handleSubmit((values) => submit.mutate(values))}
      >
        <FormField
          label="New password"
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

        <FormField label="Confirm it" error={form.formState.errors.confirm?.message}>
          {(control) => (
            <Input
              {...control}
              {...form.register('confirm')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={submit.isPending}>
          {submit.isPending ? 'Saving…' : 'Set the password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
