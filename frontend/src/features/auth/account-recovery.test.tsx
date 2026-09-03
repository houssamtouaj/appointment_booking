import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'
import { en } from '@/i18n/en'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The three account screens their four siblings had tests for and they did not:
 * accepting an invitation, resetting a password, and asking for the link that
 * makes the reset possible.
 *
 * Each has exactly one thing it exists to get right, and none of the three is
 * visible from a happy path. The invitation screen renders a business name and
 * an invited address from a bare token, which is what makes it *not* look like a
 * phishing page. The reset screen collapses two different server answers into
 * one sentence, because "that token is spent" and "we have never seen it" are
 * the same fact to the person holding a dead link. And the forgot screen says
 * the same thing whether or not the address has an account, which is its entire
 * reason for existing.
 */

const TOKEN = 'invitation-token-abc'

const PREVIEW = {
  email: 'amelie@slotflow.app',
  businessName: 'Belle Époque',
  role: 'STAFF',
  expiresAt: '2026-09-08T10:00:00Z',
}

let handler: (config: AxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse
let requests: { url: string; method?: string; data?: unknown }[]

function ok(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

function fail(
  status: number,
  code: string,
  config: AxiosRequestConfig,
  extra: Record<string, unknown> = {},
) {
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
    data: { status, code, detail: 'The server said no', ...extra },
    headers: {},
    config,
  }
  error.toJSON = () => ({})
  return Promise.reject(error)
}

/** Never answers, so a pending state can be looked at. */
function hang(): Promise<AxiosResponse> {
  return new Promise(() => {})
}

/** Everything the screen asked for, minus the bootstrap refresh every screen makes. */
function screenRequests() {
  return requests.filter((request) => request.url !== '/api/auth/refresh')
}

const adapter: AxiosAdapter = (config) => {
  requests.push({
    url: config.url ?? '',
    method: config.method,
    data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
  })
  return Promise.resolve(handler(config)) as ReturnType<AxiosAdapter>
}

function renderAt(entry: string) {
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

/** Anonymous, which is what all three of these screens are reached as. */
function anonymousBootstrap(config: AxiosRequestConfig) {
  return fail(401, 'UNAUTHENTICATED', config)
}

beforeEach(() => {
  requests = []
  client.defaults.adapter = adapter
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
  vi.mocked(toast.success).mockClear()
})

describe('accepting an invitation', () => {
  it('shows a skeleton while the preview is in flight, and no form', async () => {
    handler = (config) => (config.url === '/api/auth/refresh' ? anonymousBootstrap(config) : hang())

    renderAt(`/accept-invitation/${TOKEN}`)

    expect(await screen.findByRole('status')).toHaveTextContent('Loading the invitation')
    // Nothing to fill in until the screen can say who invited whom.
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()
  })

  it('names the business and the invited address, which is what makes it not a phishing page', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh' ? anonymousBootstrap(config) : ok(PREVIEW, config)

    renderAt(`/accept-invitation/${TOKEN}`)

    expect(await screen.findByText('Belle Époque')).toBeInTheDocument()
    expect(screen.getByText('amelie@slotflow.app')).toBeInTheDocument()
    // The token goes in the path, encoded — it is a credential, not a search term.
    expect(requests.map((request) => request.url)).toContain(`/api/public/invitations/${TOKEN}`)
  })

  it('explains a used invitation instead of failing at it', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? anonymousBootstrap(config)
        : fail(410, 'INVITATION_CONSUMED', config)

    renderAt(`/accept-invitation/${TOKEN}`)

    // Its own copy, distinct from "we do not recognise this link": arriving here
    // twice is the most likely way anyone arrives here at all.
    expect(await screen.findByText('This invitation has already been used')).toBeInTheDocument()
    expect(
      screen.getByText(/Invitations work once and expire after seven days/),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to log in' })).toHaveAttribute('href', '/login')
    expect(screen.queryByLabelText('Your name')).not.toBeInTheDocument()
  })

  it('tells a mistyped link apart from a used one', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? anonymousBootstrap(config)
        : fail(404, 'NOT_FOUND', config)

    renderAt('/accept-invitation/half-a-token')

    expect(await screen.findByText('This invitation is not valid')).toBeInTheDocument()
    expect(screen.getByText(/Check that you copied the whole address/)).toBeInTheDocument()
  })

  it('sends the person to log in with the password they just set', async () => {
    handler = (config) => {
      if (config.url === '/api/auth/refresh') return anonymousBootstrap(config)
      if (config.method === 'post') return ok(undefined, config)
      return ok(PREVIEW, config)
    }

    const user = userEvent.setup()
    const router = renderAt(`/accept-invitation/${TOKEN}`)

    await user.type(await screen.findByLabelText('Your name'), 'Amélie Rousseau')
    await user.type(screen.getByLabelText('Password'), 'a-good-password')
    await user.click(screen.getByRole('button', { name: 'Join the team' }))

    // 204 and no session: accepting sets a password, it does not sign anyone in.
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(toast.success).toHaveBeenCalledWith(
      'Your account is ready. Sign in with your new password.',
    )
    expect(requests.some((request) => request.url.endsWith('/accept'))).toBe(true)
  })

  it('surfaces a refusal on the form rather than replacing the screen', async () => {
    handler = (config) => {
      if (config.url === '/api/auth/refresh') return anonymousBootstrap(config)
      if (config.method === 'post') return fail(410, 'INVITATION_CONSUMED', config)
      return ok(PREVIEW, config)
    }

    const user = userEvent.setup()
    renderAt(`/accept-invitation/${TOKEN}`)

    await user.type(await screen.findByLabelText('Your name'), 'Amélie Rousseau')
    await user.type(screen.getByLabelText('Password'), 'a-good-password')
    await user.click(screen.getByRole('button', { name: 'Join the team' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invitation has already been used or has expired.',
    )
    // Somebody else may have accepted it in another tab; the form stays on screen.
    expect(screen.getByLabelText('Your name')).toBeInTheDocument()
  })
})

describe('resetting a password', () => {
  it('will not submit two passwords that differ', async () => {
    handler = anonymousBootstrap

    const user = userEvent.setup()
    renderAt('/reset-password/reset-token')

    await user.type(await screen.findByLabelText('New password'), 'a-good-password')
    await user.type(screen.getByLabelText('Confirm it'), 'a-good-passwrod')
    await user.click(screen.getByRole('button', { name: 'Set the password' }))

    expect(await screen.findByText('The two passwords do not match')).toBeInTheDocument()
    // The token is single-use, so a typo here costs a second email. Nothing is
    // sent until the two agree.
    expect(screenRequests()).toHaveLength(0)
  })

  it('sends the password alone, never the confirmation', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh' ? anonymousBootstrap(config) : ok(undefined, config)

    const user = userEvent.setup()
    const router = renderAt('/reset-password/reset-token')

    await user.type(await screen.findByLabelText('New password'), 'a-good-password')
    await user.type(screen.getByLabelText('Confirm it'), 'a-good-password')
    await user.click(screen.getByRole('button', { name: 'Set the password' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    const post = screenRequests().find((request) => request.url === '/api/auth/reset-password')
    expect(post?.data).toEqual({ token: 'reset-token', password: 'a-good-password' })
    expect(toast.success).toHaveBeenCalledWith('Your password was changed. Sign in with it.')
  })

  it.each([
    ['VALIDATION_FAILED', 422],
    ['NOT_FOUND', 404],
  ])(
    'says one thing about a dead link, whichever way the server says it (%s)',
    async (code, status) => {
      handler = (config) =>
        config.url === '/api/auth/refresh' ? anonymousBootstrap(config) : fail(status, code, config)

      const user = userEvent.setup()
      renderAt('/reset-password/spent-token')

      await user.type(await screen.findByLabelText('New password'), 'a-good-password')
      await user.type(screen.getByLabelText('Confirm it'), 'a-good-password')
      await user.click(screen.getByRole('button', { name: 'Set the password' }))

      // Spent, expired, or never ours. The API does not distinguish and neither
      // should the screen — the only useful next step is the same one.
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That link is no longer valid. Ask for a new one.',
      )
      expect(screen.getByRole('link', { name: 'Ask for a new one' })).toHaveAttribute(
        'href',
        '/forgot-password',
      )
    },
  )

  it('puts a server message about the token in the banner rather than losing it', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? anonymousBootstrap(config)
        : fail(422, 'VALIDATION_FAILED', config, {
            errors: [
              { field: 'password', message: 'Too short' },
              // No input is registered at this path. React Hook Form accepts
              // `setError` on it in silence, so without the unmatched list this
              // sentence would vanish.
              { field: 'token', message: 'This link was already used' },
            ],
          })

    const user = userEvent.setup()
    renderAt('/reset-password/spent-token')

    await user.type(await screen.findByLabelText('New password'), 'a-good-password')
    await user.type(screen.getByLabelText('Confirm it'), 'a-good-password')
    await user.click(screen.getByRole('button', { name: 'Set the password' }))

    // Two live regions by design — the banner for the form as a whole and the
    // field's own message — so this asks for the sentences rather than the roles.
    // A regex, because the banner prints the server's field name beside the
    // sentence — `token — This link was already used` across two elements.
    expect(await screen.findByText(/This link was already used/)).toBeInTheDocument()
    // The field's own message is this app's, not the server's: `password` is a
    // field this form owns, so `messageFor` replaces Bean Validation's English
    // "Too short" with the dictionary's sentence in the reader's language. The
    // unmatched `token` entry above still carries the server's prose, because
    // nothing here can predict what it will say.
    expect(screen.getByText(en.errors.fieldPassword)).toBeInTheDocument()
  })
})

describe('asking for a reset link', () => {
  it('says the same thing whether or not the address has an account', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh' ? anonymousBootstrap(config) : ok(undefined, config)

    const user = userEvent.setup()
    renderAt('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'nobody@example.com')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    // The API answers 202 either way (D6). This screen's whole job is to mirror
    // that, so the confirmation names the address back without claiming an
    // account exists for it.
    const confirmation = await screen.findByRole('status')
    expect(confirmation).toHaveTextContent('Check your inbox')
    expect(confirmation).toHaveTextContent('nobody@example.com')
    expect(confirmation).toHaveTextContent(/If .*has an account/)
    expect(confirmation).toHaveTextContent(
      /we answer the same way whether or not an account exists/,
    )
  })

  it('replaces the form with the confirmation, so the same address is not sent twice', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh' ? anonymousBootstrap(config) : ok(undefined, config)

    const user = userEvent.setup()
    renderAt('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    await screen.findByRole('status')
    expect(screen.queryByRole('button', { name: 'Send the link' })).not.toBeInTheDocument()
  })

  it('reports a rate limit, which is the one failure it can have', async () => {
    handler = (config) =>
      config.url === '/api/auth/refresh'
        ? anonymousBootstrap(config)
        : fail(429, 'RATE_LIMITED', config)

    const user = userEvent.setup()
    renderAt('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many requests. Wait a minute and try again.',
    )
    // Still the form, not the confirmation: nothing was sent, and saying "check
    // your inbox" here would be a lie the person acts on.
    expect(screen.getByRole('button', { name: 'Send the link' })).toBeInTheDocument()
  })

  it('does not ask the API about a malformed address', async () => {
    handler = anonymousBootstrap

    const user = userEvent.setup()
    renderAt('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'not-an-address')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    // Caught here on purpose: "that is not an email address" is a fact about the
    // text in the box and reveals nothing about who has an account.
    await waitFor(() => expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid'))
    expect(screenRequests()).toHaveLength(0)
  })
})
