import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { resetBootstrap } from '@/api/bootstrap'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'
import { addDays, todayIn, weekOf } from '@/lib/time'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The wave's screen-level gate. Every case is the demo script or a gate bullet,
 * against payloads shaped like the ones the running API returns.
 *
 * Fixtures are positioned relative to today in the business's zone, using the
 * same helpers the components use. That is deliberate rather than circular:
 * `time.test.ts` pins those helpers against hard-coded dates independently, so
 * here they are a verified fixture generator, and the alternative — a frozen
 * clock — makes the availability requests depend on fake timers interacting with
 * userEvent.
 */

const TZ = 'Europe/Paris'
const SLUG = 'demo-salon'

const COUPE = {
  id: '09c7eb7b-22ed-4475-b2a7-ccd4d875386b',
  name: 'Coupe classique',
  description: 'Wash, cut and finish.',
  durationMinutes: 30,
  priceCents: 3500,
}

const COULEUR = {
  id: '4ad89e39-26f2-4354-b42d-015322070b00',
  name: 'Couleur',
  description: 'Single-process colour, roots to ends.',
  durationMinutes: 60,
  priceCents: 7200,
}

const AMELIE = { id: '4e2ce84b-db0d-4502-b27e-8cb4a978884c', displayName: 'Amélie Rousseau' }
const CAMILLE = { id: '1be88c2a-c8c6-492b-bf1d-d333d27ea2a1', displayName: 'Camille Bérard' }

/** The demo tenant's shape: six opening rows for seven days, so Sunday is closed. */
const BUSINESS = {
  slug: SLUG,
  name: 'Belle Époque',
  timezone: TZ,
  currency: 'EUR',
  depositRequired: true,
  depositPercent: 20,
  openingHours: [
    { dayOfWeek: 'MONDAY', opensAt: '08:30:00', closesAt: '18:30:00', closesNextDay: false },
    { dayOfWeek: 'TUESDAY', opensAt: '08:30:00', closesAt: '18:30:00', closesNextDay: false },
    { dayOfWeek: 'WEDNESDAY', opensAt: '09:00:00', closesAt: '18:30:00', closesNextDay: false },
    { dayOfWeek: 'THURSDAY', opensAt: '08:30:00', closesAt: '18:30:00', closesNextDay: false },
    { dayOfWeek: 'FRIDAY', opensAt: '08:30:00', closesAt: '18:30:00', closesNextDay: false },
    { dayOfWeek: 'SATURDAY', opensAt: '09:00:00', closesAt: '14:00:00', closesNextDay: false },
  ],
  services: [COULEUR, COUPE],
}

type Handler = (config: AxiosRequestConfig) => unknown

let handlers: { business?: Handler; staff?: Handler; availability?: Handler }

function ok(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

function problem(status: number, code: string, requestId?: string) {
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
      data: { status, code, detail: 'The requested resource does not exist.' },
      headers: requestId ? { 'x-request-id': requestId } : {},
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

  const handler = url.includes('/availability')
    ? handlers.availability
    : url.includes('/staff')
      ? handlers.staff
      : handlers.business

  if (!handler) throw new Error(`no handler for ${url}`)
  return Promise.resolve(ok(handler(config), config)) as ReturnType<AxiosAdapter>
}

function renderAt(path: string) {
  client.defaults.adapter = adapter
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    // The shell's session menu reads the auth context, so every public screen
    // still renders inside the provider. The adapter 401s /api/auth, which is
    // what an anonymous visitor gets and what these screens are written for.
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

/** A slot at a given day and Paris wall clock, expressed as the UTC the API sends. */
function slotAt(dayKey: string, parisClock: string, ...staffIds: string[]) {
  // Paris is UTC+2 in the summer months these fixtures use; the assertions that
  // depend on an exact clock build the expectation the same way.
  const [hour, minute] = parisClock.split(':').map(Number)
  const start = new Date(
    `${dayKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`,
  )
  return {
    start: start.toISOString().replace('.000Z', 'Z'),
    end: new Date(start.getTime() + 30 * 60_000).toISOString().replace('.000Z', 'Z'),
    staffIds: staffIds.length > 0 ? staffIds : [AMELIE.id],
  }
}

beforeEach(() => {
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
  handlers = { business: () => BUSINESS }
})

describe('the landing page', () => {
  it('renders prices from priceCents and the business currency', async () => {
    renderAt(`/b/${SLUG}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Belle Époque' })).toBeVisible()
    // 7200 minor units of EUR. The digits are what matter; the separator and
    // symbol placement follow the test runner's locale.
    expect(screen.getByText(/72[.,]00/)).toBeVisible()
    expect(screen.getByText(/35[.,]00/)).toBeVisible()
  })

  it('never hard-codes the euro — a yen tenant renders yen, with no minor units', async () => {
    handlers.business = () => ({
      ...BUSINESS,
      currency: 'JPY',
      services: [{ ...COUPE, priceCents: 4500 }],
    })
    renderAt(`/b/${SLUG}`)

    expect(await screen.findByText(/¥\s?4,500/)).toBeVisible()
    expect(screen.queryByText(/€/)).not.toBeInTheDocument()
  })

  it('says Closed on a day with no opening-hours row rather than leaving a gap', async () => {
    renderAt(`/b/${SLUG}`)

    // The demo sends six rows; Sunday has none, and a missing row is a shut door
    // rather than missing data.
    const sunday = await screen.findByRole('rowheader', { name: /Sunday/ })
    const row = sunday.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Closed')).toBeVisible()
  })

  it('never asserts that a deposit is required (F5)', async () => {
    renderAt(`/b/${SLUG}`)
    await screen.findByRole('heading', { level: 1, name: 'Belle Époque' })

    // depositRequired is true on this payload and still only means "maybe":
    // PublicBusinessService reports the raw setting, and only the booking
    // response ANDs it with payments being enabled.
    expect(screen.getByText(/20% deposit may be requested/i)).toBeVisible()
    expect(screen.queryByText(/deposit is required/i)).not.toBeInTheDocument()
  })

  it('shows a designed 404 for an unknown slug, not a blank page', async () => {
    handlers.business = problem(404, 'NOT_FOUND')
    renderAt('/b/unknown-slug')

    expect(await screen.findByRole('heading', { level: 1, name: 'No business here' })).toBeVisible()
    expect(screen.getByText('/b/unknown-slug')).toBeVisible()
  })

  it('offers a retry and the request id when the load fails', async () => {
    handlers.business = problem(500, 'INTERNAL_ERROR', 'req-abc-123')
    renderAt(`/b/${SLUG}`)

    // A 5xx is retried twice before it settles (query-client.ts: transient
    // failures are the ones worth retrying), so this waits past the backoff
    // rather than asserting on the skeleton.
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'This page could not be loaded',
    )
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
    expect(screen.getByText('req-abc-123')).toBeVisible()
  })
})

describe('the staff step', () => {
  it('offers "Anyone" first, because it is the option that finds the most slots', async () => {
    handlers.staff = () => [AMELIE, CAMILLE]
    renderAt(`/b/${SLUG}/book?service=${COULEUR.id}`)

    const options = await screen.findAllByRole('button', { name: /Anyone|Amélie|Camille/ })
    expect(options[0]).toHaveAccessibleName(/Anyone/)
  })

  it('skips itself when exactly one person performs the service', async () => {
    handlers.staff = () => [AMELIE]
    handlers.availability = () => []
    const router = renderAt(`/b/${SLUG}/book?service=${COUPE.id}`)

    // Straight past a question with one answer, into the picker.
    await waitFor(() => expect(router.state.location.search).toContain('staff=anyone'))
    expect(await screen.findByRole('heading', { level: 1, name: 'When suits you?' })).toBeVisible()
  })
})

describe('the slot picker', () => {
  const monday = weekOf(todayIn(TZ)).from
  const tuesday = addDays(monday, 1)

  beforeEach(() => {
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = () => [
      // Non-round minutes, which is what the engine actually produces: it walks
      // its grid from each opening window rather than from the hour.
      slotAt(monday, '09:10'),
      slotAt(monday, '09:35'),
      slotAt(monday, '14:05'),
      slotAt(tuesday, '10:00'),
    ]
  })

  const path = `/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${monday}`

  it('renders non-round minutes exactly as the API returned them', async () => {
    renderAt(path)

    expect(await screen.findByRole('button', { name: /^09:10/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^09:35/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /^14:05/ })).toBeVisible()
  })

  it('splits a day into morning and afternoon on the business clock', async () => {
    renderAt(path)
    await screen.findByRole('button', { name: /^09:10/ })

    // Scoped to one day: every day carries its own morning heading, so an
    // unscoped query finds several and proves nothing about the split.
    const monday09 = screen.getByRole('button', { name: /^09:10/ })
    const daySection = monday09.closest('section')
    expect(daySection).not.toBeNull()
    const day = within(daySection as HTMLElement)

    expect(day.getByText('Morning')).toBeVisible()
    expect(day.getByText('Afternoon')).toBeVisible()
    // 14:05 is the afternoon one — read on the business clock, not on UTC,
    // where it would still be 12:05 and morning.
    expect(day.getByRole('button', { name: /^14:05/ })).toBeVisible()
  })

  it('gives each day exactly one tab stop, so 98 slots do not become 98 of them', async () => {
    renderAt(path)
    await screen.findByRole('button', { name: /^09:10/ })

    // The roving-tabindex contract: one reachable button per day, the rest
    // reached with the arrow keys.
    const reachable = screen
      .getAllByRole('button')
      .filter((button) => /^\d{2}:\d{2}/.test(button.getAttribute('aria-label') ?? ''))
      .filter((button) => button.tabIndex === 0)

    expect(reachable).toHaveLength(2)
  })

  it('moves within a day with the arrow keys and selects with Enter', async () => {
    const user = userEvent.setup()
    renderAt(path)

    const first = await screen.findByRole('button', { name: /^09:10/ })
    first.focus()

    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: /^09:35/ })).toHaveFocus()

    // Across the morning/afternoon boundary: the arrows walk the day, not one
    // part of it.
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: /^14:05/ })).toHaveFocus()

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('button', { name: /^09:35/ })).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: /^09:35/ })).toHaveAttribute('aria-pressed', 'true')
    // Asserted by text: the timezone banner is also a role=status, and which
    // of the two is present depends on the runner's zone.
    expect(await screen.findByText(/Selected/)).toBeVisible()
  })

  it('reaches the next day with Tab', async () => {
    const user = userEvent.setup()
    renderAt(path)

    const first = await screen.findByRole('button', { name: /^09:10/ })
    first.focus()
    await user.tab()

    expect(screen.getByRole('button', { name: /^10:00/ })).toHaveFocus()
  })
})

describe('an empty week', () => {
  const monday = weekOf(todayIn(TZ)).from
  const laterDay = addDays(monday, 21)

  it('offers to find the next opening, and jumps the picker to it', async () => {
    const user = userEvent.setup()
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = (config) => {
      const params = config.params as { from: string; to: string }
      // The widened one-shot search: from today, 61 days inclusive. Only it
      // knows about the slot three weeks out.
      const span = Number(new Date(params.to)) - Number(new Date(params.from))
      return span > 7 * 86_400_000 ? [slotAt(laterDay, '11:00')] : []
    }

    const router = renderAt(`/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${monday}`)

    expect(await screen.findByText('No times this week')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Find the next opening' }))

    await waitFor(() => expect(router.state.location.search).toContain(`date=${laterDay}`))
  })

  it('says so plainly when the whole booking window is empty', async () => {
    const user = userEvent.setup()
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = () => []

    renderAt(`/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${monday}`)

    await user.click(await screen.findByRole('button', { name: 'Find the next opening' }))

    // A truthful answer, and different from an error: the request succeeded.
    expect(await screen.findByText(/Nothing is bookable in the next two months/)).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
