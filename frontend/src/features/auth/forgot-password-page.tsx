import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { forgotPassword } from '@/api/auth'
import { applyFieldErrors } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { forgotPasswordRequestSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/components/form-alert'
import type { ForgotPasswordRequest, ValidationError } from '@/types'

/**
 * `/forgot-password`. The screen whose whole job is to say the same thing
 * either way.
 *
 * The API answers 202 whether or not the address is registered (D6) — anything
 * else is an account-enumeration endpoint. Mirroring that on the client is the
 * entire point of the screen, so there is deliberately no "we could not find
 * that account" branch to write, and the success copy is careful not to promise
 * that an email is on its way to *this* address.
 *
 * The one thing that is not mirrored: a malformed address is caught here before
 * the request, because "that is not an email address" is a fact about the text
 * in the box and reveals nothing about who has an account.
 */
export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [alert, setAlert] = useState<{
    message: string
    unmatched: ValidationError[]
    requestId?: string
  } | null>(null)

  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  })

  const request = useMutation({
    mutationFn: forgotPassword,
    onSuccess: () => {
      setAlert(null)
      setSent(true)
    },
    onError: (error) => {
      // Only ever a rate limit or an outage — never "no such account".
      setAlert({
        message: describeError(error, {
          RATE_LIMITED: 'Too many requests. Wait a minute and try again.',
        }),
        unmatched: applyFieldErrors(error, form),
        requestId: requestIdOf(error),
      })
    },
  })

  return (
    <AuthLayout
      eyebrow="Account"
      title="Reset your password"
      description={sent ? undefined : 'We will email you a link. It works once and lasts an hour.'}
      footer={
        <Link to="/login" className="text-primary underline underline-offset-4">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <div role="status" className="border-border bg-card rounded-sm border px-4 py-4 text-sm">
          <p className="text-foreground font-medium">Check your inbox</p>
          <p className="text-muted-foreground mt-1">
            If <span className="text-foreground">{form.getValues('email')}</span> has an account, a
            reset link is on its way. It expires in an hour and can be used once.
          </p>
          <p className="text-muted-foreground mt-3 text-xs">
            No email? Check spam, then try again — we answer the same way whether or not an account
            exists, so this page cannot tell you which it was.
          </p>
        </div>
      ) : (
        <>
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
            onSubmit={form.handleSubmit((values) => request.mutate(values))}
          >
            <FormField label="Email" error={form.formState.errors.email?.message}>
              {(control) => (
                <Input
                  {...control}
                  {...form.register('email')}
                  type="email"
                  autoComplete="username"
                />
              )}
            </FormField>

            <Button type="submit" size="lg" className="mt-1 w-full" disabled={request.isPending}>
              {request.isPending ? 'Sending…' : 'Send the link'}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
