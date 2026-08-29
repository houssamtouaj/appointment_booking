import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { logout } from '@/api/auth'
import { client, refreshSession, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { beginSession, endSessionQuietly, getAccessToken, hasSession } from '@/api/session'
import { resetBootstrap } from '@/api/bootstrap'
import { AuthProvider } from '@/features/auth/auth-provider'
import { useAuth } from '@/features/auth/use-auth'

// Sonner renders into a portal and its own store; spying on the module is the
// only way to assert "no toast" rather than "no toast I happened to query for".
const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))
vi.mock('sonner', () => ({
  toast: { error: toastError, success: toastSuccess },
}))

type Handler = (config: AxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse

let handler: Handler
let requests: string[]

const USER = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'demo@slotflow.app',
  fullName: 'Demo Owner',
  role: 'OWNER',
  business: {
    id: '22222222-2222-2222-2222-222222222222',
    slug: 'demo-salon',
    name: 'Demo Salon',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  },
}

const AUTH = { accessToken: 'token-1', tokenType: 'Bearer', expiresIn: 900, user: USER }

function ok(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

function unauthorized(config: AxiosRequestConfig, code = 'UNAUTHENTICATED') {
  const error = new Error('Request failed with status code 401') as Error & {
    isAxiosError: boolean
    config: unknown
    response: unknown
    toJSON: () => object
  }
  error.isAxiosError = true
  error.config = config
  error.response = {
    status: 401,
    data: { status: 401, code, detail: 'nope' },
    headers: {},
    config,
  }
  error.toJSON = () => ({})
  return Promise.reject(error)
}

const adapter: AxiosAdapter = (config) => {
  requests.push(config.url ?? '')
  return Promise.resolve(handler(config)) as ReturnType<AxiosAdapter>
}

function Probe() {
  const { status, user, signOut } = useAuth()
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="user">{user?.fullName ?? '—'}</p>
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  )
}

function renderProvider() {
  const queryClient = createQueryClient()
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

beforeEach(() => {
  requests = []
  client.defaults.adapter = adapter
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
  toastError.mockClear()
  toastSuccess.mockClear()
})

describe('the bootstrap', () => {
  it('opens silently for a first-time visitor', async () => {
    // The wave gate, and the detail that reads as broken rather than as
    // careful: the bootstrap refresh 401s for anonymous and for expired alike,
    // and only one of those is an event worth announcing.
    handler = (config) => unauthorized(config)

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('restores a session with exactly one refresh and one me', async () => {
    handler = (config) => (config.url === '/api/auth/refresh' ? ok(AUTH, config) : ok(USER, config))

    renderProvider()

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    expect(screen.getByTestId('user')).toHaveTextContent('Demo Owner')
    // Two requests, in that order. StrictMode double-mounts effects in
    // development, which is why the bootstrap promise lives at module scope
    // rather than in a ref.
    expect(requests).toEqual(['/api/auth/refresh', '/api/auth/me'])
  })
})

describe('teardown', () => {
  it('leaves the query cache empty after a sign-out', async () => {
    // Not eyeballed (wave gate). Leaving one tenant's dashboard in memory across
    // a sign-out is how the next login flashes the previous user's numbers.
    handler = (config) => (config.url === '/api/auth/refresh' ? ok(AUTH, config) : ok(USER, config))

    const queryClient = renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))

    queryClient.setQueryData(['dashboard', 'today'], { bookings: 7 })
    expect(queryClient.getQueryCache().getAll().length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })

  it('signs out on a device that cannot reach the API', async () => {
    // `logout` documents itself as tolerant of failure, and the button takes it
    // at its word: `SessionMenu` awaits `signOut()` and then toasts and
    // navigates, with no catch anywhere on the path. A rejection here is an
    // unhandled one — no "Signed out", no redirect, and on a public route an
    // offline user left on a page that has already forgotten who they are.
    beginSession('token-1')
    handler = () => Promise.reject(new Error('Network Error'))

    await expect(logout()).resolves.toBeUndefined()

    expect(hasSession()).toBe(false)
    expect(getAccessToken()).toBeNull()
  })

  it('says REFRESH_REUSED in its own words and empties the cache', async () => {
    handler = (config) => (config.url === '/api/auth/refresh' ? ok(AUTH, config) : ok(USER, config))

    const queryClient = renderProvider()
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
    queryClient.setQueryData(['dashboard', 'today'], { bookings: 7 })

    // The chain was revoked. Not a generic 401, and it does not get the generic
    // 401 copy.
    resetInFlightRefresh()
    handler = (config) => unauthorized(config, 'REFRESH_REUSED')
    await refreshSession().catch(() => undefined)

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      'You were signed out because your session was used from somewhere else.',
    )
    expect(queryClient.getQueryCache().getAll()).toEqual([])
  })
})
