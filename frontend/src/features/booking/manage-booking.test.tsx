import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { client, resetInFlightRefresh } from '@/api/client'
import { resetBootstrap } from '@/api/bootstrap'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'
import type { BookingStatus } from '@/types'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * `/booking/:cancellationToken` — the manage page, which is also the page Stripe
 * returns to.
 *
 * Two of the gate items here are about *not* doing something: a `?checkout=success`
 * on an unpaid booking must not render as paid, and the polling must stop. Both
 * are asserted by counting requests and by looking for copy that should be
 * absent, because both failures look fine on screen.
 */

const TOKEN = 'c0ffee00-1111-4222-8333-444455556666'

/** Far enough out that the cancellation deadline has not passed. */
const STARTS_AT = new Date(Date.now() + 5 * 86_400_000).toISOString().replace(/\.\d+Z$/, 'Z')

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: '7f1b0e6a-9d0c-4d1e-8a2b-3c4d5e6f7a8b',
    serviceId: '4ad89e39-26f2-4354-b42d-015322070b00',
    staffId: '4e2ce84b-db0d-4502-b27e-8cb4a978884c',
    startsAt: STARTS_AT,
    endsAt: new Date(Date.parse(STARTS_AT) + 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    status: 'CONFIRMED' as BookingStatus,
    priceCents: 7200,
    currency: 'EUR',
    cancellationToken: TOKEN,
    // Always false (backend D7), and the page has to say so in words.
    depositRefundable: false,
    cancellable: true,
    cancellationDeadline: new Date(Date.parse(STARTS_AT) - 24 * 3_600_000)
      .toISOString()
      .replace(/\.\d+Z$/, 'Z'),
    // The token lookup carries the guest; the creation response does not.
    guest: { name: 'Camille Doe', email: 'camille@example.test' },
    ...overrides,
  }
}

/** A hold: `PENDING`, with somewhere to pay and a deadline to pay by. */
function pending(overrides: Record<string, unknown> = {}) {
  return booking({
    status: 'PENDING',
    checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_123',
    expiresAt: new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    ...overrides,
  })
}

type Handler = (config: AxiosRequestConfig) => unknown

let get: Handler
let remove: Handler | undefined
/** Every `GET` of the booking, so that "polling stopped" is a countable claim. */
let reads = 0

function problem(status: number, code: string, extra: Record<string, unknown> = {}) {
  return (config: AxiosRequestConfig) => {
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
      data: { status, title: code, detail: 'The server refused this request.', code, ...extra },
      headers: {},
      config,
    }
    error.toJSON = () => ({})
    throw error
  }
}

const adapter: AxiosAdapter = (config) => {
  const url = config.url ?? ''
  // Anonymous: the bootstrap refresh must fail, or the shell waits forever.
  if (url.includes('/api/auth')) return Promise.reject(problem(401, 'UNAUTHENTICATED')(config))

  const handler = config.method === 'delete' ? remove : get
  if (!handler) throw new Error(`no handler for ${config.method} ${url}`)
  if (config.method !== 'delete') reads += 1

  return Promise.resolve({
    data: handler(config),
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }) as ReturnType<AxiosAdapter>
}

function renderAt(path: string) {
  client.defaults.adapter = adapter
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

beforeEach(() => {
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
  reads = 0
  remove = undefined
  get = () => booking()
  window.sessionStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------

describe('the five statuses', () => {
  const cases: { status: BookingStatus; heading: RegExp; extra?: Record<string, unknown> }[] = [
    { status: 'PENDING', heading: /waiting for your deposit/i, extra: { cancellable: true } },
    { status: 'CONFIRMED', heading: /your booking is confirmed/i },
    { status: 'CANCELLED', heading: /this booking was cancelled/i, extra: { cancellable: false } },
    { status: 'COMPLETED', heading: /this appointment is done/i, extra: { cancellable: false } },
    { status: 'NO_SHOW', heading: /recorded as a no-show/i, extra: { cancellable: false } },
  ]

  it.each(cases)('$status renders as a designed screen', async ({ status, heading, extra }) => {
    get = () => booking({ status, ...extra })
    renderAt(`/booking/${TOKEN}`)

    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeVisible()
    // The token resolves forever (backend D1), so none of these is a 404 — a
    // cancelled booking is rendered as cancelled, not as missing.
    expect(screen.queryByText(/could not find that booking/i)).not.toBeInTheDocument()
  })

  it('offers nothing to cancel on a booking that is already over', async () => {
    get = () => booking({ status: 'COMPLETED', cancellable: false })
    renderAt(`/booking/${TOKEN}`)

    await screen.findByRole('heading', { level: 1, name: /this appointment is done/i })
    expect(screen.queryByRole('button', { name: /cancel this booking/i })).not.toBeInTheDocument()
  })

  it('shows the guest details the token earned', async () => {
    renderAt(`/booking/${TOKEN}`)

    expect(await screen.findByText(/Camille Doe/)).toBeVisible()
    expect(screen.getByText(/camille@example.test/)).toBeVisible()
  })

  it('renders a 404 token as a designed screen rather than a blank page', async () => {
    get = problem(404, 'NOT_FOUND')
    renderAt(`/booking/${TOKEN}`)

    expect(await screen.findByText(/could not find that booking/i)).toBeVisible()
  })
})

describe('the Stripe return', () => {
  it('does not render an unpaid booking as paid, whatever the query string says', async () => {
    // Anyone can type this URL. The redirect is something a browser did; the
    // payment is something the webhook confirms.
    get = () => pending()
    renderAt(`/booking/${TOKEN}?checkout=success`)

    await screen.findByRole('heading', { level: 1, name: /waiting for your deposit/i })
    expect(screen.getByText(/waiting for your bank to confirm/i)).toBeVisible()
    expect(screen.queryByText(/your deposit came through/i)).not.toBeInTheDocument()
  })

  it('thanks a customer only once the booking itself says CONFIRMED', async () => {
    get = () => booking()
    renderAt(`/booking/${TOKEN}?checkout=success`)

    expect(await screen.findByText(/your deposit came through/i)).toBeVisible()
  })

  it('says nothing at all about payment on a cancelled booking', async () => {
    // The sweeper cancelled an abandoned hold and Stripe still sent them here.
    get = () => booking({ status: 'CANCELLED', cancellable: false })
    renderAt(`/booking/${TOKEN}?checkout=success`)

    await screen.findByRole('heading', { level: 1, name: /this booking was cancelled/i })
    expect(screen.queryByText(/came through/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/waiting for your bank/i)).not.toBeInTheDocument()
  })

  it('reassures a customer who backed out, and leaves the way on', async () => {
    get = () => pending()
    renderAt(`/booking/${TOKEN}?checkout=cancelled`)

    expect(await screen.findByText(/your slot is still held/i)).toBeVisible()
    expect(screen.getByRole('link', { name: /pay the deposit/i })).toHaveAttribute(
      'href',
      'https://checkout.stripe.test/c/pay/cs_test_123',
    )
  })

  it('clears the token it kept for the round trip', async () => {
    window.sessionStorage.setItem('slotflow.booking.token', TOKEN)
    renderAt(`/booking/${TOKEN}`)

    await screen.findByRole('heading', { level: 1, name: /confirmed/i })
    // The redirect landed, so the fallback has done its job. sessionStorage
    // would have died with the tab anyway; this is not a cleanup it needs.
    await waitFor(() => expect(window.sessionStorage.getItem('slotflow.booking.token')).toBeNull())
  })
})

describe('polling for a webhook that has not landed', () => {
  /** Advances the fake clock inside `act`, so React applies what the timers caused. */
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('asks again while the booking is PENDING, and stops the moment it is not', async () => {
    vi.useFakeTimers()
    get = () => (reads >= 3 ? booking() : pending())
    renderAt(`/booking/${TOKEN}`)

    await tick(0)
    expect(
      screen.getByRole('heading', { level: 1, name: /waiting for your deposit/i }),
    ).toBeVisible()

    // Two seconds apart to begin with: a webhook usually beats the redirect by
    // less than that.
    await tick(6_000)
    expect(
      screen.getByRole('heading', { level: 1, name: /your booking is confirmed/i }),
    ).toBeVisible()

    const afterConfirming = reads
    await tick(60_000)
    // Nothing further. A page that kept asking after the answer arrived is a
    // page making requests for the rest of the session.
    expect(reads).toBe(afterConfirming)
  })

  it('gives up after ninety seconds and offers a button instead', async () => {
    vi.useFakeTimers()
    get = () => pending()
    renderAt(`/booking/${TOKEN}`)

    await tick(0)
    await tick(89_000)
    const beforeTheDeadline = reads
    expect(beforeTheDeadline).toBeGreaterThan(5)

    await tick(10_000)
    expect(screen.getByRole('button', { name: /check again/i })).toBeVisible()

    const afterTheDeadline = reads
    await tick(120_000)
    expect(reads).toBe(afterTheDeadline)
  })

  it('stops polling when the page unmounts', async () => {
    vi.useFakeTimers()
    get = () => pending()
    const { unmount } = renderAt(`/booking/${TOKEN}`)

    await tick(0)
    await tick(10_000)
    const whileMounted = reads
    expect(whileMounted).toBeGreaterThan(1)

    unmount()
    await tick(60_000)
    // The interval belongs to the query observer, which the unmount tore down.
    // A hand-rolled setInterval is how this page ends up polling from a route
    // nobody is looking at.
    expect(reads).toBe(whileMounted)
  })

  it('does not poll a booking that was never pending', async () => {
    vi.useFakeTimers()
    get = () => booking()
    renderAt(`/booking/${TOKEN}`)

    await tick(0)
    const once = reads
    await tick(60_000)
    expect(reads).toBe(once)
  })
})

describe('a hold that has run out', () => {
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  const expired = { expiresAt: new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, 'Z') }

  it('does not claim the slot is still held, or offer a way to pay for it', async () => {
    // `PENDING` past its deadline is a real state: the sweeper cancels an unpaid
    // hold at the thirty-minute mark, so until it runs the API still answers
    // PENDING for a slot that has gone back into the calendar.
    get = () => pending(expired)
    renderAt(`/booking/${TOKEN}?checkout=cancelled`)

    expect(
      await screen.findByRole('heading', { level: 1, name: /this hold has expired/i }),
    ).toBeVisible()
    expect(screen.queryByText(/still held/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/nobody else can take it/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /pay the deposit/i })).not.toBeInTheDocument()
  })

  it('says so while the page is open, not only on the load after it', async () => {
    vi.useFakeTimers()
    // Read once: the page polls, and a deadline recomputed on every answer is a
    // deadline that never arrives.
    const deadline = new Date(Date.now() + 5_000).toISOString().replace(/\.\d+Z$/, 'Z')
    get = () => pending({ expiresAt: deadline })
    renderAt(`/booking/${TOKEN}`)

    await tick(0)
    expect(screen.getByRole('link', { name: /pay the deposit/i })).toBeVisible()

    // This is the page somebody leaves open while they go and find their card.
    await tick(6_000)
    expect(screen.getByRole('heading', { level: 1, name: /this hold has expired/i })).toBeVisible()
    expect(screen.queryByRole('link', { name: /pay the deposit/i })).not.toBeInTheDocument()
  })
})

describe('a refresh that fails', () => {
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  it('keeps the booking on screen rather than replacing it with an error', async () => {
    vi.useFakeTimers()
    let broken = false
    // A 429 rather than a 5xx so the failure is the query's answer immediately:
    // `createQueryClient` retries a 5xx twice, and this test is about what the
    // page does with the error, not about when it arrives.
    get = (config) => (broken ? problem(429, 'RATE_LIMITED')(config) : pending())
    renderAt(`/booking/${TOKEN}`)

    await tick(0)
    expect(
      screen.getByRole('heading', { level: 1, name: /waiting for your deposit/i }),
    ).toBeVisible()

    broken = true
    await tick(4_000)

    // The booking is still the answer this page has. Replacing all of it —
    // status, times, guest, cancel button, and the link that is the customer's
    // only credential — because one poll failed is a page that loses everything
    // to a blip.
    expect(
      screen.getByRole('heading', { level: 1, name: /waiting for your deposit/i }),
    ).toBeVisible()
    expect(screen.queryByText(/could not be loaded/i)).not.toBeInTheDocument()
    expect(screen.getByText(/could not check for an update/i)).toBeVisible()
  })
})

describe('a second booking in the same tab', () => {
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }

  const OTHER = 'd1e2f3a4-5555-4666-8777-888899990000'

  it('gets its own ninety seconds, not what is left of the first booking’s', async () => {
    vi.useFakeTimers()
    get = () => pending()
    const { router } = renderAt(`/booking/${TOKEN}`)

    await tick(0)
    await tick(95_000)
    expect(screen.getByRole('button', { name: /check again/i })).toBeVisible()

    // The manage page is one route element, so this re-renders the hook rather
    // than remounting it. Without a reset the second booking arrives with the
    // first one's window already closed: no polling at all for a payment a
    // webhook may confirm a second later.
    get = () => pending({ cancellationToken: OTHER })
    await act(async () => {
      await router.navigate(`/booking/${OTHER}`)
    })
    await tick(0)

    expect(screen.queryByRole('button', { name: /check again/i })).toBeNull()
    expect(screen.getByText(/checking for your payment/i)).toBeVisible()

    const afterArriving = reads
    await tick(6_000)
    expect(reads).toBeGreaterThan(afterArriving)
  })
})

describe('cancelling', () => {
  it('says deposits are not refunded, in words, before the click', async () => {
    const user = userEvent.setup()
    renderAt(`/booking/${TOKEN}`)

    await user.click(await screen.findByRole('button', { name: /cancel this booking/i }))

    const dialog = await screen.findByRole('alertdialog')
    // Backend D7 makes this a written requirement rather than a nicety.
    expect(dialog).toHaveTextContent('Deposits are not refunded.')
  })

  it('frees the slot and re-renders the booking as cancelled', async () => {
    const user = userEvent.setup()
    remove = () => booking({ status: 'CANCELLED', cancellable: false })
    renderAt(`/booking/${TOKEN}`)

    await user.click(await screen.findByRole('button', { name: /cancel this booking/i }))
    await user.click(await screen.findByRole('button', { name: /yes, cancel it/i }))

    expect(
      await screen.findByRole('heading', { level: 1, name: /this booking was cancelled/i }),
    ).toBeVisible()
    // The DELETE answers 200 with the cancelled booking, so there is nothing to
    // refetch and the screen does not flash a loading state.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('renders 409 CANCELLATION_CUTOFF as an answer, with the deadline that passed', async () => {
    const user = userEvent.setup()
    const deadline = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z')
    remove = problem(409, 'CANCELLATION_CUTOFF', { deadline, depositRefundable: false })
    renderAt(`/booking/${TOKEN}`)

    await user.click(await screen.findByRole('button', { name: /cancel this booking/i }))
    await user.click(await screen.findByRole('button', { name: /yes, cancel it/i }))

    // Inside the dialog, not in a toast: it is an answer to the question the
    // dialog just asked, and it carries a deadline worth reading twice.
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(/too late to cancel this online/i)
    expect(dialog).toHaveTextContent(/the deadline was/i)
    // And the way to make the mistake twice is closed.
    expect(screen.getByRole('button', { name: /yes, cancel it/i })).toBeDisabled()
  })

  it('disables the button and says why when the server says it is too late', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z')
    get = () => booking({ cancellable: false, cancellationDeadline: past })
    renderAt(`/booking/${TOKEN}`)

    const button = await screen.findByRole('button', { name: /cancel this booking/i })
    // Shown and disabled rather than hidden: a missing control leaves "can I
    // cancel this?" unanswered, and the deadline that passed is the answer.
    expect(button).toBeDisabled()
    expect(screen.getByText(/the deadline to cancel online was/i)).toBeVisible()
  })
})

describe('the link back', () => {
  it('is on the page as copyable text', async () => {
    renderAt(`/booking/${TOKEN}`)

    await screen.findByRole('heading', { level: 1, name: /confirmed/i })
    expect(screen.getByText(`${window.location.origin}/booking/${TOKEN}`)).toBeVisible()
  })
})
