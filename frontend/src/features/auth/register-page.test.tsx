import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The bodies below are copied verbatim from what the running API answers — see
 * the wave-2 notes. A fixture invented from the javadoc is a fixture that agrees
 * with a document rather than with a server.
 */
const SLUG_TAKEN = {
  type: 'https://slotflow.dev/problems/slug-taken',
  title: 'Slug already taken',
  status: 409,
  detail: 'The address "demo-salon" is already taken. Try another.',
  instance: '/api/auth/register',
  code: 'SLUG_TAKEN',
  slug: 'demo-salon',
}

const EMAIL_TAKEN = {
  type: 'https://slotflow.dev/problems/email-taken',
  title: 'Email already registered',
  status: 409,
  detail: 'That email address is already registered.',
  instance: '/api/auth/register',
  code: 'EMAIL_TAKEN',
}

const VALIDATION_FAILED = {
  type: 'https://slotflow.dev/problems/validation-failed',
  title: 'Validation failed',
  status: 422,
  detail: 'The request contains invalid fields. See errors for the details.',
  instance: '/api/auth/register',
  code: 'VALIDATION_FAILED',
  errors: [
    { field: 'currency', message: 'must be a three-letter ISO 4217 code' },
    // A field the form does not have. The API validates a request body and a
    // form is only ever a view of one, so this is the ordinary case rather than
    // a contrived one.
    { field: 'somethingTheFormLacks', message: 'must not be blank' },
  ],
}

let reply: (config: AxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse

function problem(body: { status: number }, config: AxiosRequestConfig) {
  const error = new Error(String(body.status)) as Error & {
    isAxiosError: boolean
    config: unknown
    response: unknown
    toJSON: () => object
  }
  error.isAxiosError = true
  error.config = config
  error.response = { status: body.status, data: body, headers: {}, config }
  error.toJSON = () => ({})
  return Promise.reject(error)
}

const adapter: AxiosAdapter = (config) => Promise.resolve(reply(config)) as ReturnType<AxiosAdapter>

async function fillAndSubmit(body: { status: number }) {
  reply = (config) =>
    config.url === '/api/auth/register'
      ? problem(body, config)
      : problem({ status: 401, code: 'UNAUTHENTICATED' } as { status: number }, config)

  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: ['/register'] })} />
      </AuthProvider>
    </QueryClientProvider>,
  )

  // `fireEvent.change` and not `userEvent.type`. Typing is more faithful, and
  // here it is also fifty synchronous re-renders of a seven-field form for no
  // extra coverage: the slug derivation reads `event.target.value`, so one
  // change event exercises it exactly as fifty do. The typed version passed in
  // isolation and timed out inside the full suite, which is the definition of a
  // test that will fail on somebody else's machine one morning.
  await screen.findByLabelText('Business name')
  fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Demo Salon' } })
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Dana Okoye' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'dana@example.com' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } })
  await userEvent.click(screen.getByRole('button', { name: 'Create business' }))
}

beforeEach(() => {
  client.defaults.adapter = adapter
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
})

describe('the register screen', () => {
  it('derives the slug from the business name', async () => {
    await fillAndSubmit(SLUG_TAKEN)

    // "Demo Salon" typed into the name; nobody touched the slug.
    expect(screen.getByLabelText('Booking page address')).toHaveValue('demo-salon')
  })

  it('lands 409 SLUG_TAKEN on the slug field, not in a banner', async () => {
    // The endpoint distinguishes the two 409s precisely so the form can say
    // which word to change. Putting either in a banner throws that away.
    await fillAndSubmit(SLUG_TAKEN)

    await waitFor(() =>
      expect(screen.getByLabelText('Booking page address')).toHaveAccessibleDescription(
        /That address is taken/,
      ),
    )
    expect(screen.getByLabelText('Booking page address')).toBeInvalid()
  })

  it('lands 409 EMAIL_TAKEN on the email field', async () => {
    await fillAndSubmit(EMAIL_TAKEN)

    await waitFor(() =>
      expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
        /account already exists for this address/,
      ),
    )
  })

  it('shows a 422 entry the form has no input for instead of swallowing it', async () => {
    await fillAndSubmit(VALIDATION_FAILED)

    // The one that maps goes on its input...
    await waitFor(() => expect(screen.getByLabelText('Currency')).toBeInvalid())
    // ...and the one that does not is on the screen rather than gone. Queried by
    // its text and not by role: the field error below is an `alert` too, which is
    // the point of both of them.
    expect(screen.getByText('somethingTheFormLacks')).toBeInTheDocument()
    expect(screen.getByText(/must not be blank/)).toBeInTheDocument()
  })
})
