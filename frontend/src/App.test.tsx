import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { resetBootstrap } from '@/api/bootstrap'
import { AuthProvider } from '@/features/auth/auth-provider'
import { DEMO_SLUG } from '@/lib/env'
import { routes } from '@/routes'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'demo@slotflow.app',
  fullName: 'Demo Owner',
  role: 'OWNER',
  business: {
    id: '22222222-2222-2222-2222-222222222222',
    slug: DEMO_SLUG,
    name: 'Demo Salon',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  },
}

const AUTH = { accessToken: 'token-1', tokenType: 'Bearer', expiresIn: 900, user: USER }

/**
 * The public booking payload, shaped like the real one because wave 3's screens
 * parse it (F4). A stub that returned the session user — which is what this
 * adapter used to do for every URL — now fails at the schema boundary and
 * renders an error state, which is the parsing layer working rather than a test
 * to loosen.
 */
const PUBLIC_BUSINESS = {
  slug: DEMO_SLUG,
  name: 'Demo Salon',
  timezone: 'Europe/Paris',
  currency: 'EUR',
  depositRequired: false,
  openingHours: [
    { dayOfWeek: 'MONDAY', opensAt: '09:00:00', closesAt: '17:00:00', closesNextDay: false },
  ],
  services: [
    {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Coupe classique',
      description: 'Wash, cut and finish.',
      durationMinutes: 30,
      priceCents: 3500,
    },
  ],
}

/**
 * From wave 2 the route table is behind a session, so every render here needs
 * one — or needs to prove it does not have one. `role` is a parameter because
 * `RequireOwner` is the only thing in the table that reads it.
 */
function stubApi(session: 'owner' | 'staff' | 'anonymous') {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    if (session === 'anonymous') {
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

    const user = { ...USER, role: session === 'owner' ? 'OWNER' : 'STAFF' }
    const url = config.url ?? ''
    const data = url.includes('/api/public/businesses')
      ? PUBLIC_BUSINESS
      : url === '/api/auth/refresh'
        ? { ...AUTH, user }
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

async function renderAt(path: string, session: 'owner' | 'staff' | 'anonymous' = 'owner') {
  stubApi(session)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  // Every render waits for the bootstrap. Nothing protected is allowed to
  // render before it answers, so asserting sooner asserts the skeleton.
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  return router
}

beforeEach(() => {
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
})

describe('the application shell', () => {
  it('renders the shell and its skip link', async () => {
    await renderAt('/dashboard')

    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
  })

  it('redirects the bare root to the demo tenant (F16)', async () => {
    const router = await renderAt('/', 'anonymous')

    expect(router.state.location.pathname).toBe(`/b/${DEMO_SLUG}`)
  })

  it('renders a real 404 rather than redirecting', async () => {
    await renderAt('/no-such-page', 'anonymous')

    expect(screen.getByRole('heading', { level: 1, name: 'No such page' })).toBeInTheDocument()
  })
})

describe('the route table', () => {
  // F12: three of these are built into outbound mail by the backend's
  // FrontendLinks. A link in an inbox from three weeks ago still has to resolve,
  // so this test exists to make a rename fail loudly rather than quietly.
  const paths = [
    `/b/${DEMO_SLUG}`,
    `/b/${DEMO_SLUG}/book`,
    '/booking/some-cancellation-token',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password/some-token',
    '/accept-invitation/some-token',
    '/dashboard',
    '/calendar',
    '/services',
    '/team',
    '/team/11111111-1111-1111-1111-111111111111/hours',
    '/settings',
  ]

  it.each(paths)('%s resolves to a page, not the 404', async (path) => {
    await renderAt(path)

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
    expect(heading).not.toHaveTextContent('No such page')
  })
})

describe('the route guards', () => {
  it('sends an anonymous visitor to /login, remembering where they were going', async () => {
    const router = await renderAt('/calendar?view=week', 'anonymous')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/calendar?view=week')}`)
  })

  it('lets a staff member into the shared routes', async () => {
    await renderAt('/calendar', 'staff')

    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument()
  })

  it('tells a staff member why /settings is closed rather than bouncing them (F19)', async () => {
    // A silent redirect is indistinguishable from a broken link, and they would
    // try it again tomorrow.
    await renderAt('/settings', 'staff')

    expect(screen.getByRole('alert')).toHaveTextContent('This page is for owners')
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument()
  })
})
