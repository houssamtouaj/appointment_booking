import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly, getAccessToken } from '@/api/session'
import { resetBootstrap } from '@/api/bootstrap'
import { AuthProvider } from '@/features/auth/auth-provider'
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
    slug: 'demo-salon',
    name: 'Demo Salon',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  },
}

let handler: (config: AxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse
let requests: string[]

function ok(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

function fail(status: number, code: string, config: AxiosRequestConfig) {
  const error = new Error(String(status)) as Error & {
    isAxiosError: boolean
    config: unknown
    response: unknown
    toJSON: () => object
  }
  error.isAxiosError = true
  error.config = config
  error.response = {
    status,
    data: { status, code, detail: 'Email or password is incorrect' },
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

function renderLogin(entry = '/login') {
  const router = createMemoryRouter(routes, { initialEntries: [entry] })
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
  requests = []
  client.defaults.adapter = adapter
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
})

describe('the login screen', () => {
  it('signs in with one click on the demo button and lands on the dashboard', async () => {
    // The brief asks for this button by name, and the endpoint exists so that
    // no credential ships in the JavaScript bundle.
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? fail(401, 'UNAUTHENTICATED', config)
        : ok({ accessToken: 'token-1', tokenType: 'Bearer', expiresIn: 900, user: USER }, config)

    const router = renderLogin()
    const button = await screen.findByRole('button', { name: 'Log in as demo admin' })
    await userEvent.click(button)

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(requests).toContain('/api/auth/demo-login')
    // The token is in memory and nowhere a page dump would find it.
    expect(getAccessToken()).toBe('token-1')
    expect(JSON.stringify(localStorage)).not.toContain('token-1')
    expect(document.cookie).not.toContain('token-1')
  })

  it('says one thing for a wrong password, an unknown address and a disabled account', async () => {
    // The API answers the same 401 for all three, deliberately. Saying which on
    // the client would undo that.
    handler = (config) => fail(401, 'UNAUTHENTICATED', config)

    renderLogin()
    await screen.findByRole('button', { name: 'Log in' })
    await userEvent.type(screen.getByLabelText('Email'), 'nobody@example.com')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.')
  })

  it('finishes the journey the guard interrupted', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? fail(401, 'UNAUTHENTICATED', config)
        : ok({ accessToken: 'token-1', tokenType: 'Bearer', expiresIn: 900, user: USER }, config)

    const router = renderLogin(`/login?next=${encodeURIComponent('/calendar?view=week')}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Log in as demo admin' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/calendar'))
    expect(router.state.location.search).toBe('?view=week')
  })

  it('will not follow a ?next= that points off the site', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? fail(401, 'UNAUTHENTICATED', config)
        : ok({ accessToken: 'token-1', tokenType: 'Bearer', expiresIn: 900, user: USER }, config)

    const router = renderLogin(`/login?next=${encodeURIComponent('https://evil.example/steal')}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Log in as demo admin' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })
})
