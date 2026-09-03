import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'

import { forgotPassword } from '@/api/auth'
import { forgotPasswordRequestSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/components/form-alert'
import type { ForgotPasswordRequest } from '@/types'
import { useTranslation } from '@/i18n'

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
  const { t } = useTranslation()
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotPasswordRequest>({
    resolver: zodResolver(forgotPasswordRequestSchema),
    defaultValues: { email: '' },
  })

  const { alert, reportFailure, clear } = useFormErrorSummary(form)

  const request = useMutation({
    mutationFn: forgotPassword,
    onSuccess: () => {
      clear()
      setSent(true)
    },
    onError: (error) => {
      // Only ever a rate limit or an outage — never "no such account".
      reportFailure(error, {
        copy: { RATE_LIMITED: 'errors.tooManyRequests' },
      })
    },
  })

  return (
    <AuthLayout
      eyebrow={t('auth.eyebrow')}
      title={t('auth.forgot.title')}
      description={sent ? undefined : t('auth.forgot.description')}
      footer={
        <Link to="/login" className="text-primary underline underline-offset-4">
          {t('auth.forgot.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <div role="status" className="border-border bg-card rounded-sm border px-4 py-4 text-sm">
          <p className="text-foreground font-medium">{t('auth.forgot.sentTitle')}</p>
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
          {alert ? <FormAlert {...alert} /> : null}

          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => request.mutate(values))}
          >
            <FormField label={t('auth.forgot.email')} error={form.formState.errors.email?.message}>
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
              {request.isPending ? t('auth.forgot.submitting') : t('auth.forgot.submit')}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  )
}
