import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'

import { register as registerBusiness } from '@/api/auth'
import { applyFieldErrors, isApiError } from '@/api/error'
import { describeError, requestIdOf } from '@/api/error-copy'
import { registerRequestSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/features/auth/form-alert'
import { useAuth } from '@/features/auth/use-auth'
import type { RegisterRequest, ValidationError } from '@/types'

/**
 * `/register` (F17). Self-registration ships so that a reviewer can have their
 * own empty tenant rather than sharing the demo's, which is the difference
 * between trying the product and watching somebody else's data change under
 * them.
 *
 * One request creates the business, its default booking policy and its owner,
 * and signs them in — so this screen has no "now log in" step.
 */
export function RegisterPage() {
  const { status, adoptSession } = useAuth()
  const [alert, setAlert] = useState<{
    message: string
    unmatched: ValidationError[]
    requestId?: string
  } | null>(null)

  const form = useForm<RegisterRequest>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: {
      businessName: '',
      slug: '',
      // The browser already knows, and it is right far more often than a
      // default of Europe/Paris would be. The API validates it against the tz
      // database and answers 422 naming the field if the two disagree.
      timezone: resolveBrowserTimezone(),
      currency: 'EUR',
      fullName: '',
      email: '',
      password: '',
    },
  })

  const create = useMutation({
    mutationFn: registerBusiness,
    onSuccess: (auth) => {
      adoptSession(auth)
      toast.success(`${auth.user.business.name} is ready`)
    },
    onError: (error) => {
      // The two 409s the endpoint documents. Both are field problems rather than
      // form problems, and landing them on the right input is the difference
      // between "change this word" and "read this paragraph and guess".
      if (isApiError(error, 'SLUG_TAKEN')) {
        form.setError(
          'slug',
          { type: 'server', message: 'That address is taken. Try another.' },
          { shouldFocus: true },
        )
        setAlert(null)
        return
      }
      if (isApiError(error, 'EMAIL_TAKEN')) {
        form.setError(
          'email',
          { type: 'server', message: 'An account already exists for this address.' },
          { shouldFocus: true },
        )
        setAlert(null)
        return
      }

      // Everything else: attach what maps to a field, and surface what does not
      // rather than letting React Hook Form drop it silently.
      const unmatched = applyFieldErrors(error, form)
      setAlert({
        message: describeError(error, {
          VALIDATION_FAILED: 'Some of these details need fixing.',
        }),
        unmatched,
        requestId: requestIdOf(error),
      })
    },
  })

  if (status === 'authenticated') return <Navigate to="/dashboard" replace />
  if (status === 'loading') return null

  const errors = form.formState.errors
  const pending = create.isPending

  return (
    <AuthLayout
      eyebrow="Account"
      title="Create a business"
      description="One step. You get an owner account, an empty calendar and a public booking page."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-primary underline underline-offset-4">
            Log in
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
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <FormField label="Business name" error={errors.businessName?.message}>
          {(control) => (
            <Input
              {...control}
              {...form.register('businessName', {
                // Fill the slug from the name until somebody edits the slug
                // themselves — the form already knows, so a flag kept in sync by
                // hand would only be one more thing to get wrong.
                //
                // `getFieldState` and not `form.formState.dirtyFields`: that
                // one is a proxy over the last *rendered* snapshot, and nothing
                // in this component reads `dirtyFields` during render, so it is
                // never subscribed. With the default `onSubmit` mode a keystroke
                // in the slug field re-renders nothing, the snapshot is still
                // empty when this handler runs, and typing the slug BEFORE the
                // business name got it overwritten. `getFieldState` reads the
                // live store instead.
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                  if (form.getFieldState('slug').isDirty) return
                  form.setValue('slug', slugify(event.target.value))
                },
              })}
              autoComplete="organization"
            />
          )}
        </FormField>

        <FormField
          label="Booking page address"
          hint="Letters, digits and hyphens. This is permanent — it is the URL customers bookmark."
          error={errors.slug?.message}
        >
          {(control) => (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground shrink-0 font-mono text-xs">/b/</span>
              <Input
                {...control}
                {...form.register('slug')}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}
        </FormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            label="Timezone"
            hint="Every time in the product is shown in it."
            error={errors.timezone?.message}
          >
            {(control) => <Input {...control} {...form.register('timezone')} autoComplete="off" />}
          </FormField>

          <FormField
            label="Currency"
            hint="Three letters, ISO 4217."
            error={errors.currency?.message}
          >
            {(control) => (
              <Input
                {...control}
                {...form.register('currency')}
                autoComplete="off"
                maxLength={3}
                className="uppercase"
              />
            )}
          </FormField>
        </div>

        <FormField label="Your name" error={errors.fullName?.message}>
          {(control) => <Input {...control} {...form.register('fullName')} autoComplete="name" />}
        </FormField>

        <FormField label="Email" error={errors.email?.message}>
          {(control) => (
            <Input {...control} {...form.register('email')} type="email" autoComplete="username" />
          )}
        </FormField>

        <FormField label="Password" hint="At least 8 characters." error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              {...form.register('password')}
              type="password"
              autoComplete="new-password"
            />
          )}
        </FormField>

        <Button type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
          {pending ? 'Creating…' : 'Create business'}
        </Button>
      </form>
    </AuthLayout>
  )
}

/** `Dana's Clinic!` becomes `dana-s-clinic`. The API's rule is the authority; this is a head start. */
function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      // Strip the combining marks NFKD just separated out, so "Café" gives "cafe"
      // rather than "caf-". `\p{M}` rather than a U+0300–U+036F range written
      // literally: the range is right for Latin and wrong for everything else, and
      // a file full of invisible codepoints survives exactly one careless editor.
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
  )
}

function resolveBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'
  } catch {
    return 'Europe/Paris'
  }
}
