import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { demoLogin, login } from '@/api/auth'
import { describeError, requestIdOf } from '@/api/error-copy'
import { loginRequestSchema } from '@/api/schemas/auth'
import { FormField } from '@/components/form-field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AuthLayout } from '@/features/auth/auth-layout'
import { FormAlert } from '@/components/form-alert'
import { safeNextPath } from '@/features/auth/next-path'
import { useAuth } from '@/hooks/use-auth'
import type { AuthResponse, LoginRequest } from '@/types'

/**
 * `/login`. Two ways in, and the second one is the one the brief names.
 */
export function LoginPage() {
  const { status, adoptSession } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [alert, setAlert] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | undefined>(undefined)

  const form = useForm<LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    // Present for every field, always. `applyFieldErrors` asks the form what it
    // knows about via `getValues()`, and a field with no default is absent from
    // that answer — so a server error for it would be reported as unmatched.
    defaultValues: { email: '', password: '' },
  })

  const signIn = useMutation({
    mutationFn: (variables: LoginRequest | 'demo') =>
      variables === 'demo' ? demoLogin() : login(variables),
    onSuccess: (auth: AuthResponse) => {
      adoptSession(auth)
      toast.success(`Signed in as ${auth.user.fullName}`)
      // No `navigate` here: `adoptSession` flips the status, and the redirect
      // below is the single place that decides where a signed-in visitor to
      // this route goes.
    },
    onError: (error, variables) => {
      // Which button failed is the only thing separating these two, because the
      // API cannot: `SecurityConfig` keeps `/api/auth/demo-login` out of the
      // public allowlist, so a deployment without the `demo` profile refuses it
      // from the filter chain with the same 401 UNAUTHENTICATED a wrong password
      // gets. The absent `@Profile` controller never gets a say, and the 404
      // this screen used to look for never arrives — which left a reviewer who
      // typed no password being told their password was wrong.
      const unauthenticated =
        variables === 'demo'
          ? 'The demo account is not available — the API is running without its demo profile.'
          : // Deliberately one message for three causes: the API answers the
            // same 401 for an unknown address, a wrong password and a
            // deactivated account, and saying which would undo that here.
            'Email or password is incorrect.'
      setAlert(describeError(error, { UNAUTHENTICATED: unauthenticated }))
      setRequestId(requestIdOf(error))
    },
  })

  if (status === 'authenticated') return <Navigate to={next} replace />
  if (status === 'loading') return null

  const pending = signIn.isPending

  return (
    <AuthLayout
      eyebrow="Account"
      title="Log in"
      description="Manage your calendar, services and team."
      footer={
        <>
          No account yet?{' '}
          <Link to="/register" className="text-primary underline underline-offset-4">
            Create a business
          </Link>
        </>
      }
    >
      {alert ? <FormAlert message={alert} requestId={requestId} /> : null}

      {/* The demo button sits above the form, not below it. A reviewer opening
          the portfolio link wants one click, and burying it under a form they
          have no credentials for is the whole failure this endpoint exists to
          avoid. */}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={pending}
        onClick={() => signIn.mutate('demo')}
      >
        Log in as demo admin
      </Button>
      <p className="text-muted-foreground mt-2 text-xs">
        Signs you into a seeded business with services, staff and bookings. Nothing you do to it is
        permanent.
      </p>

      <div className="my-7 flex items-center gap-3" aria-hidden="true">
        <span className="bg-rule h-px flex-1" />
        <span className="text-muted-foreground text-2xs tracking-eyebrow font-mono uppercase">
          or
        </span>
        <span className="bg-rule h-px flex-1" />
      </div>

      <form
        noValidate
        className="grid gap-4"
        onSubmit={form.handleSubmit((values) => signIn.mutate(values))}
      >
        <FormField label="Email" error={form.formState.errors.email?.message}>
          {(control) => (
            <Input {...control} {...form.register('email')} type="email" autoComplete="username" />
          )}
        </FormField>

        <FormField label="Password" error={form.formState.errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              {...form.register('password')}
              type="password"
              autoComplete="current-password"
            />
          )}
        </FormField>

        <Button
          type="submit"
          variant="outline"
          size="lg"
          className="mt-1 w-full"
          disabled={pending}
        >
          {pending ? 'Signing in…' : 'Log in'}
        </Button>
      </form>

      <p className="mt-4 text-sm">
        <Link to="/forgot-password" className="text-muted-foreground underline underline-offset-4">
          Forgot your password?
        </Link>
      </p>
    </AuthLayout>
  )
}
