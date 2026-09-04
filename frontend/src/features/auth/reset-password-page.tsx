import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { resetPassword } from '@/api/auth'
import { passwordSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFormErrorSummary } from '@/hooks/use-form-error-summary'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/components/form-alert'
import { z } from 'zod'
import { translate, useTranslation, type TKey } from '@/i18n'

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
    // A **key**, not a sentence. A schema built at module scope captures the
    // language at import time and then never updates; the render translates it.
    message: 'auth.reset.mismatch' satisfies TKey,
  })

type FormValues = z.infer<typeof formSchema>

/** A resolver message, which is a key, back as prose — see `login-page.tsx`. */
function message(raw: string | undefined): string | undefined {
  return raw ? translate(raw as TKey) : undefined
}

export function ResetPasswordPage() {
  const { t } = useTranslation()
  const { token = '' } = useParams()
  const navigate = useNavigate()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { password: '', confirm: '' },
  })

  const { alert, reportFailure } = useFormErrorSummary(form)

  const submit = useMutation({
    mutationFn: (values: FormValues) => resetPassword({ token, password: values.password }),
    onSuccess: () => {
      toast.success(t('auth.reset.done'))
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      // The server's `errors[]` names `password`, which this form has, and
      // `token`, which it does not — so the token message comes back unmatched
      // and lands in the banner rather than disappearing.
      reportFailure(error, {
        messageFor: { password: 'errors.fieldPassword' },
        copy: {
          // The single shape this endpoint fails in that is worth its own
          // sentence: the token is spent, expired, or was never ours. The API
          // does not distinguish between them and neither should this.
          VALIDATION_FAILED: 'errors.resetLinkExpired',
          NOT_FOUND: 'errors.resetLinkExpired',
        },
      })
    },
  })

  return (
    <AuthLayout
      eyebrow={t('auth.eyebrow')}
      title={t('auth.reset.title')}
      description={t('auth.reset.description')}
      footer={
        <>
          Link expired?{' '}
          <Link to="/forgot-password" className="text-primary underline underline-offset-4">
            {t('auth.reset.askAgain')}
          </Link>
        </>
      }
    >
      {alert ? <FormAlert {...alert} /> : null}

      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => submit.mutate(values))}
      >
        <FormField
          label={t('auth.reset.password')}
          hint={t('auth.reset.passwordHint')}
          error={message(form.formState.errors.password?.message)}
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

        <FormField
          label={t('auth.reset.confirm')}
          // The message on this field is a dictionary key the schema wrote, not
          // prose. react-hook-form types `message` as `string` and the value is
          // ours, so the cast says what the type cannot.
          error={message(form.formState.errors.confirm?.message)}
        >
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
          {submit.isPending ? t('auth.reset.submitting') : t('auth.reset.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
