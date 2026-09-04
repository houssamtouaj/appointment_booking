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
import { translate, useTranslation, type TKey } from '@/i18n'

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
/** A resolver message, which is a key, back as prose — see `login-page.tsx`. */
function message(raw: string | undefined): string | undefined {
  return raw ? translate(raw as TKey) : undefined
}

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
            {/* The address is inside the sentence rather than in its own span:
                French does not put it where English does. It is still shown
                back, which is what makes "check that address" actionable. */}
            {t('auth.forgot.sentBody', { email: form.getValues('email') })}
          </p>
          <p className="text-muted-foreground mt-3 text-xs">{t('auth.forgot.sentSpam')}</p>
        </div>
      ) : (
        <>
          {alert ? <FormAlert {...alert} /> : null}

          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((values) => request.mutate(values))}
          >
            <FormField
              label={t('auth.forgot.email')}
              error={message(form.formState.errors.email?.message)}
            >
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
