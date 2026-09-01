import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly, hasSession } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { SessionMenu } from '@/features/auth/session-menu'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The public header's session control, which has three states the admin
 * `AccountMenu` does not need: a stranger, a bootstrap in flight, and standing on
 * the login page it would otherwise offer a link to.
 *
 * The sign-out flow itself is asserted once, in `admin-shell.test.tsx` — both
 * controls call `useSignOut`, and testing four steps twice was the duplication
 * the hook removed. What is asserted here is that this control is wired to it.
 */

const OWNER = {
  id: '55555555-5555-5555-5555-555555555555',
  email: 'demo@slotflow.app',
  fullName: 'Camille Bérard',
  role: 'OWNER' as const,
  business: {
    id: '66666666-6666-6666-6666-666666666666',
    slug: 'belle-epoque',
    name: 'Belle Époque',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  },
}

function stubApi(user: typeof OWNER | null, { hang = false } = {}) {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    // A bootstrap that never answers, which is the loading state.
    if (hang) return new Promise(() => {}) as ReturnType<AxiosAdapter>

    if (!user) {
      const error = new Error('401') as Error & {
        isAxiosError: boolean
        config: unknown
        response: unknown
        toJSON: () => object
      }
      error.isAxiosError = true
      error.config = config
      error.response = {
        status: 401,
        data: { status: 401, code: 'UNAUTHENTICATED', detail: 'nope' },
        headers: {},
        config,
      }
      error.toJSON = () => ({})
      return Promise.reject(error)
    }

    const data =
      (config.url ?? '') === '/api/auth/refresh'
        ? { accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user }
        : user

    return Promise.resolve({
      data,
      status: 200,
      statusText: 'OK',
      headers: {},
      config: config as AxiosResponse['config'],
    }) as ReturnType<AxiosAdapter>
  }
  client.defaults.adapter = adapter
}

function renderMenu(user: typeof OWNER | null, { path = '/b/belle-epoque', hang = false } = {}) {
  stubApi(user, { hang })
  const router = createMemoryRouter(
    [
      { path: '/b/:slug', element: <SessionMenu /> },
      { path: '/login', element: <SessionMenu /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

beforeEach(() => {
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
  vi.mocked(toast.success).mockClear()
})

describe('the public header session control', () => {
  it('shows nothing but a gap while the bootstrap is in flight', () => {
    renderMenu(OWNER, { hang: true })

    // A "Log in" link that appears for one round trip and then turns into a name
    // is worse than a gap the same width.
    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('offers a stranger the way in', async () => {
    renderMenu(null)

    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
  })

  it('does not offer a link to the page you are already on', async () => {
    const router = renderMenu(null)

    // Proving the link is there first, so its later absence is the route's doing
    // rather than a bootstrap that had not answered yet.
    expect(await screen.findByRole('link', { name: 'Log in' })).toBeInTheDocument()

    await act(() => router.navigate('/login'))

    expect(screen.queryByRole('link', { name: 'Log in' })).not.toBeInTheDocument()
  })

  it('names who is signed in, and where', async () => {
    renderMenu(OWNER)

    expect(await screen.findByText('Camille Bérard')).toBeInTheDocument()
    expect(screen.getByText(/Belle Époque/)).toBeInTheDocument()
  })

  it('signs out through the shared flow', async () => {
    const user = userEvent.setup()
    const router = renderMenu(OWNER)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(hasSession()).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Signed out')
  })
})
