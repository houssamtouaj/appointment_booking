import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly, hasSession } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'
import { toast } from 'sonner'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The shell, and the half of F19 that is courtesy rather than permission.
 *
 * The nav hiding is asserted here and the routing refusal is asserted in
 * `App.test.tsx`, which is the right split: they are two mechanisms, they are
 * both required, and a test file that covered only one of them would go green on
 * the version of this feature that was rejected — a hidden link is not a
 * permission, and a permission with a visible link is a 403 waiting to be
 * clicked.
 */

const STAFF_ID = '33333333-3333-3333-3333-333333333333'

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

const AMELIE = {
  ...OWNER,
  id: STAFF_ID,
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF' as const,
}

const STATS = {
  todayBookings: 0,
  weekBookings: 0,
  revenueCents: 0,
  depositsCents: 0,
  noShowRate: null,
  upcoming: [],
}

function stubApi(user: typeof OWNER | typeof AMELIE | null) {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    const url = config.url ?? ''

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
      url === '/api/auth/refresh'
        ? { accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user }
        : url.includes('/api/dashboard/stats')
          ? STATS
          : url.includes('/api/services')
            ? { content: [], page: 0, size: 100, totalElements: 0, totalPages: 0 }
            : url.includes('/api/staff')
              ? []
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

async function renderShell(user: typeof OWNER | typeof AMELIE | null = OWNER, path = '/dashboard') {
  stubApi(user)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  return router
}

/** The rail, which is the only nav on screen until the drawer is opened. */
function nav() {
  return screen.getByRole('navigation', { name: 'Sections' })
}

beforeEach(() => {
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
})

describe('the nav matrix (F19)', () => {
  it('gives an owner all five sections', async () => {
    await renderShell(OWNER)

    const rail = within(nav())
    for (const label of ['Dashboard', 'Calendar', 'Services', 'Team', 'Settings']) {
      expect(rail.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('hides the owner-only sections from a staff member', async () => {
    await renderShell(AMELIE)

    const rail = within(nav())
    expect(rail.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    // The whole business, not their own column: a receptionist books for
    // everyone, and the bookings endpoint is not role-scoped.
    expect(rail.getByRole('link', { name: 'Calendar' })).toBeInTheDocument()

    expect(rail.queryByRole('link', { name: 'Services' })).not.toBeInTheDocument()
    expect(rail.queryByRole('link', { name: 'Team' })).not.toBeInTheDocument()
    expect(rail.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('points a staff member at their own working hours', async () => {
    await renderShell(AMELIE)

    // `me.id` is the staff id, so the row needs no request to build.
    expect(within(nav()).getByRole('link', { name: 'Working hours' })).toHaveAttribute(
      'href',
      `/team/${STAFF_ID}/hours`,
    )
  })

  it('marks where you are without making anyone read the URL', async () => {
    await renderShell(OWNER, '/calendar')

    const rail = within(nav())
    expect(rail.getByRole('link', { name: 'Calendar' })).toHaveAttribute('aria-current', 'page')
    expect(rail.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
  })
})

describe('the shell', () => {
  it('names the business and whose session this is', async () => {
    await renderShell(OWNER)

    expect(screen.getByText('Belle Époque')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Account: Camille Bérard/ })).toBeInTheDocument()
  })

  it('offers the tenant its own booking page', async () => {
    await renderShell(OWNER)

    expect(screen.getByRole('link', { name: '/b/belle-epoque' })).toHaveAttribute(
      'href',
      '/b/belle-epoque',
    )
  })

  it('puts the same sections behind the menu button, filtered the same way', async () => {
    const user = userEvent.setup()
    await renderShell(AMELIE)

    await user.click(screen.getByRole('button', { name: 'Open menu' }))

    // Two navs now — the rail and the drawer — and the drawer must not be the
    // copy where somebody forgot the role check.
    const drawer = within(screen.getByRole('dialog'))
    expect(drawer.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(drawer.getByRole('link', { name: 'Working hours' })).toBeInTheDocument()
    expect(drawer.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('closes the drawer when a link takes you somewhere', async () => {
    const user = userEvent.setup()
    await renderShell(OWNER)

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Calendar' }))

    // Derived from the route rather than closed in an effect, so this also holds
    // for a redirect and for the back button.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('leaves the drawer shut when the route comes back to where it was opened', async () => {
    const user = userEvent.setup()
    const router = await renderShell(OWNER)

    await user.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    // Not a tap on a nav row — a history move with the drawer still standing,
    // which is what the back button does to it on a phone.
    await act(() => router.navigate('/calendar'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // Coming back must not bring the sheet with it. "Still on the page it was
    // opened on" reads correctly and re-opens a drawer nobody asked for.
    await act(() => router.navigate('/dashboard'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows no admin chrome to somebody on their way to the login screen', async () => {
    // `AdminLayout` sits above the guard so the shell is there during the
    // bootstrap. The cost of that placement would be a frame of the product's
    // insides shown to an anonymous visitor, and this is the assertion that it
    // is not paid.
    const router = await renderShell(null, '/dashboard')

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(screen.queryByRole('navigation', { name: 'Sections' })).not.toBeInTheDocument()
  })
})

describe('leaving', () => {
  /**
   * The menu's own exit, which `auth-provider.test.tsx` does not reach — that
   * file drives `signOut` through a harness button of its own, so the four steps
   * a person actually goes through (the flag, the revocation, the confirmation,
   * the redirect) were asserted nowhere.
   */
  it('revokes the session, says so, and lands on the login screen', async () => {
    const user = userEvent.setup()
    const router = await renderShell(OWNER)

    await user.click(screen.getByRole('button', { name: /Account: Camille Bérard/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(hasSession()).toBe(false)
    expect(toast.success).toHaveBeenCalledWith('Signed out')
  })

  it('replaces the admin screen rather than stacking the login on top of it', async () => {
    const user = userEvent.setup()
    const router = await renderShell(OWNER, '/calendar')

    await user.click(screen.getByRole('button', { name: /Account: Camille Bérard/ }))
    await user.click(await screen.findByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))

    // `replace`, because the screen behind is guarded: a back button that
    // returned to it would bounce straight forward again.
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.historyAction).toBe('REPLACE')
  })
})
