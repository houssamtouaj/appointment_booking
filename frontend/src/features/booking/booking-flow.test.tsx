import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import { addDays, dayKeyOf, formatDayHeading, todayIn, weekOf } from '@/lib/time'
import { en } from '@/i18n/en'

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

let handlers: {
  business?: Handler
  staff?: Handler
  availability?: Handler
  /** `POST .../bookings`. Wave 4's only write on this surface. */
  booking?: Handler
}

function ok(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

/**
 * A problem body with the extra members `ApiException.with(...)` attaches.
 *
 * The bodies below are copied from what the API actually sends —
 * `earliestStart` on a lead-time refusal, `deadline` on a cutoff, the echoed
 * slot on a `409` — rather than reduced to `{ code }`. Half the copy this wave
 * writes is built from those members, and a fixture without them would let a
 * screen that renders "too soon" pass a test for one that renders "the earliest
 * we can take you is Thursday".
 */
function problemWith(status: number, code: string, extra: Record<string, unknown> = {}) {
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
      data: { status, code, title: code, detail: 'The server refused this request.', ...extra },
      headers: {},
      config,
    }
    error.toJSON = () => ({})
    throw error
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

  const handler = url.includes('/bookings')
    ? handlers.booking
    : url.includes('/availability')
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

  it('says a business with no catalogue is not bookable, on the flow page too', async () => {
    // Same payload, one answer. A direct link to /book must not put "What are
    // you booking?" above nothing where the landing page explains itself.
    handlers.business = () => ({ ...BUSINESS, services: [] })
    renderAt(`/b/${SLUG}/book`)

    expect(await screen.findByText('Nothing is bookable here yet')).toBeVisible()
  })

  it('shows a designed 404 for an unknown slug, not a blank page', async () => {
    handlers.business = problem(404, 'NOT_FOUND')
    renderAt('/b/unknown-slug')

    expect(await screen.findByRole('heading', { level: 1, name: 'No business here' })).toBeVisible()
    // The slug is inside the sentence rather than in its own <code>: one key
    // with a placeholder, because a sentence wrapped around an element cannot be
    // translated. It is still echoed back, which is what this asserts.
    expect(screen.getByText(/Nothing is published at \/b\/unknown-slug/)).toBeVisible()
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

  it('does not offer a way back to the step that answered itself', async () => {
    handlers.staff = () => [AMELIE]
    handlers.availability = () => []
    renderAt(`/b/${SLUG}/book?service=${COUPE.id}`)

    await screen.findByRole('heading', { level: 1, name: 'When suits you?' })

    // The step is complete and says why — but it is not somewhere anyone can go:
    // StaffStep redirects straight back out of it, so a link there would be a
    // control that visibly does nothing.
    expect(screen.getByText('the only one for this service')).toBeVisible()
    expect(screen.queryByRole('link', { name: /Who/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Service/ })).toBeVisible()
  })

  it('asks again when the URL names a staff member this service does not have', async () => {
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = () => []
    // A shared link that outlived the assignment. Sending this id on to the
    // availability request buys an error screen or a permanently empty picker,
    // and no way for the customer to understand either.
    const stale = '11111111-2222-3333-4444-555555555555'
    renderAt(`/b/${SLUG}/book?service=${COULEUR.id}&staff=${stale}`)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Who would you like?' }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: /Camille/ })).toBeVisible()
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

  it('drops the selection when the week does, rather than describing a slot that is gone', async () => {
    const user = userEvent.setup()
    // Only the displayed week has anything, so "next week" genuinely redraws.
    handlers.availability = (config) => {
      const params = config.params as { from: string }
      return params.from === monday ? [slotAt(monday, '09:35')] : []
    }
    renderAt(path)

    await user.click(await screen.findByRole('button', { name: /^09:35/ }))
    expect(screen.getByText(/Selected/)).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    // The sticky bar went with it: a live Continue button for a slot no longer
    // on screen is worse than no bar at all.
    expect(await screen.findByText('No times this week')).toBeVisible()
    expect(screen.queryByText(/Selected/)).not.toBeInTheDocument()
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

  it('does not carry a failed search into the next week', async () => {
    const user = userEvent.setup()
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = (config) => {
      const params = config.params as { from: string; to: string }
      const span = Number(new Date(params.to)) - Number(new Date(params.from))
      // The widened search fails; every week request succeeds and is empty.
      if (span > 7 * 86_400_000) return problem(500, 'INTERNAL_ERROR')(config)
      return []
    }

    renderAt(`/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${monday}`)

    await user.click(await screen.findByRole('button', { name: 'Find the next opening' }))
    expect(await screen.findByRole('alert', {}, { timeout: 5000 })).toHaveTextContent(
      'The search could not be completed',
    )

    await user.click(screen.getByRole('button', { name: 'Next week' }))

    // That week's own request succeeded and the answer is that it is empty. One
    // failed search must not paint an error over every empty week after it.
    expect(await screen.findByText('No times this week')).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
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

// ---------------------------------------------------------------------------
//  Wave 4 — the details step, the write, and the ways it does not work
// ---------------------------------------------------------------------------

const TOKEN = 'c0ffee00-1111-4222-8333-444455556666'

/** A `201`, shaped like `PublicBookingResponse`. `guest` is absent by design. */
function confirmedBooking(startsAt: string) {
  return {
    id: '7f1b0e6a-9d0c-4d1e-8a2b-3c4d5e6f7a8b',
    serviceId: COULEUR.id,
    staffId: AMELIE.id,
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 60 * 60_000).toISOString().replace('.000Z', 'Z'),
    status: 'CONFIRMED',
    priceCents: COULEUR.priceCents,
    currency: 'EUR',
    cancellationToken: TOKEN,
    depositRefundable: false,
    cancellable: true,
    cancellationDeadline: new Date(Date.parse(startsAt) - 24 * 3_600_000)
      .toISOString()
      .replace('.000Z', 'Z'),
  }
}

const MONDAY = weekOf(todayIn(TZ)).from

describe('the details step', () => {
  const slot = slotAt(MONDAY, '09:35')
  const detailsPath = `/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${MONDAY}&slot=${encodeURIComponent(slot.start)}`

  beforeEach(() => {
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = () => [slot, slotAt(MONDAY, '14:05')]
  })

  it('is reached from the picker, and the slot goes into the URL verbatim', async () => {
    const user = userEvent.setup()
    const router = renderAt(`/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${MONDAY}`)

    await user.click(await screen.findByRole('button', { name: /^09:35/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Who is this for?' })).toBeVisible()
    // Byte for byte what the availability response sent. A start rebuilt from a
    // wall clock is how a booking lands an hour out on a DST boundary.
    expect(new URLSearchParams(router.state.location.search).get('slot')).toBe(slot.start)
  })

  it('restates what is being booked, on the salon clock and in the salon currency', async () => {
    renderAt(detailsPath)

    // The picker is not on screen at this step, so each of these appears once
    // and appears because the summary put it there.
    //
    // 09:35 is the Paris wall clock of a 07:35Z instant. Under any runner
    // timezone but Paris, finding it is the proof that the summary reads the
    // salon's clock rather than the reader's.
    // Day and clock are one sentence now, not two elements with the word "at"
    // between them — wave 10, because French does not join them the way English
    // does. Matched as one string, which is a closer check than two: it also
    // proves the two halves ended up in the same sentence.
    expect(
      await screen.findByText(`${formatDayHeading(dayKeyOf(slot.start, TZ))} at 09:35`),
    ).toBeVisible()
    expect(screen.getByText(/72[.,]00/)).toBeVisible()
  })

  it('says a deposit may be requested and never that one is (F5)', async () => {
    renderAt(detailsPath)

    // depositRequired is true on this payload and still only means "maybe":
    // PublicBookingService ANDs it with payments.enabled(), which this client
    // cannot see.
    expect(await screen.findByText(/If a deposit is required/i)).toBeVisible()
    expect(screen.queryByText(/you will be charged/i)).not.toBeInTheDocument()
  })

  it('will not spend a rate-limit budget on an address that is not one', async () => {
    const user = userEvent.setup()
    let posted = 0
    handlers.booking = () => {
      posted += 1
      return confirmedBooking(slot.start)
    }
    renderAt(detailsPath)

    await user.type(await screen.findByLabelText('Your name'), 'Camille Doe')
    await user.type(screen.getByLabelText('Email'), 'camille@example')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))

    expect(await screen.findByText('That does not look like an email address')).toBeVisible()
    // Caught here rather than at the server, which matters: the address is the
    // per-email rate-limit key (backend D12), so a mistyped one costs a retry.
    expect(posted).toBe(0)
  })
})

describe('a booking that works', () => {
  const slot = slotAt(MONDAY, '09:35')
  const detailsPath = `/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${MONDAY}&slot=${encodeURIComponent(slot.start)}`

  beforeEach(() => {
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = () => [slot]
  })

  async function book(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Your name'), 'Camille Doe')
    await user.type(screen.getByLabelText('Email'), 'camille@example.test')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
  }

  it('omits staffId entirely for "anyone", and sends the slot start unchanged', async () => {
    const user = userEvent.setup()
    let body: Record<string, unknown> = {}
    handlers.booking = (config) => {
      body = JSON.parse(String(config.data)) as Record<string, unknown>
      return confirmedBooking(slot.start)
    }
    renderAt(detailsPath)
    await book(user)

    await screen.findByRole('heading', { level: 1, name: 'You are booked' })
    expect(body.startsAt).toBe(slot.start)
    // Not a member of the slot's staffIds. Sending one takes the server's
    // ability to balance the booking away from it.
    expect('staffId' in body).toBe(false)
    // A blank optional field is omitted rather than sent as an empty string.
    expect('guestPhone' in body).toBe(false)
  })

  it('shows the manage link as text, not only as a button', async () => {
    const user = userEvent.setup()
    handlers.booking = () => confirmedBooking(slot.start)
    renderAt(detailsPath)
    await book(user)

    await screen.findByRole('heading', { level: 1, name: 'You are booked' })
    // The only credential this customer will ever have (backend D1). A copy
    // button alone puts it behind an API that silently does nothing on an
    // insecure origin.
    expect(screen.getByText(`${window.location.origin}/booking/${TOKEN}`)).toBeVisible()
    expect(screen.getByRole('link', { name: 'Manage this booking' })).toHaveAttribute(
      'href',
      `/booking/${TOKEN}`,
    )
  })

  it('renders a confirmation, not a checkout, when the response says CONFIRMED', async () => {
    const user = userEvent.setup()
    // The deployed configuration: depositRequired is true on the business and
    // payments are off, so every booking confirms with nothing to pay.
    handlers.booking = () => confirmedBooking(slot.start)
    renderAt(detailsPath)
    await book(user)

    expect(await screen.findByRole('heading', { level: 1, name: 'You are booked' })).toBeVisible()
    expect(screen.queryByText(/secure checkout/i)).not.toBeInTheDocument()
  })

  it('takes the deposit branch from the response and nowhere else (F5)', async () => {
    const user = userEvent.setup()
    handlers.booking = () => ({
      ...confirmedBooking(slot.start),
      status: 'PENDING',
      checkoutUrl: 'https://checkout.stripe.test/c/pay/cs_test_123',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    })
    renderAt(detailsPath)
    await book(user)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'One more step: the deposit' }),
    ).toBeVisible()
    // The hold, from expiresAt — stated before the customer leaves for a domain
    // this app does not control.
    expect(screen.getByText(/This slot is held until/)).toBeVisible()
    // D7, in words, before the click.
    expect(screen.getByText(/not refunded/)).toBeVisible()
    expect(screen.getByRole('button', { name: /Continue to secure checkout/ })).toBeVisible()
  })

  it('never says "you are booked" about a PENDING booking with nowhere to pay', async () => {
    const user = userEvent.setup()
    // The branch that should not happen — the API rolls a booking back when it
    // cannot open a Checkout session — and the one where getting it wrong is
    // worst: an unpaid hold rendered as a finished appointment.
    handlers.booking = () => ({
      ...confirmedBooking(slot.start),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d+Z$/, 'Z'),
    })
    renderAt(detailsPath)
    await book(user)

    expect(
      await screen.findByRole('heading', { level: 1, name: 'One more step: the deposit' }),
    ).toBeVisible()
    expect(screen.queryByText(/nothing else to do/i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /open your booking/i })).toHaveAttribute(
      'href',
      `/booking/${TOKEN}`,
    )
  })

  it('leaves the confirmation when the customer goes back, and keeps the link', async () => {
    const user = userEvent.setup()
    handlers.booking = () => confirmedBooking(slot.start)
    const router = renderAt(detailsPath)
    await book(user)
    await screen.findByRole('heading', { level: 1, name: 'You are booked' })

    await act(async () => {
      await router.navigate(-1)
    })

    // The URL is the details step's again, so the screen has to be too —
    // otherwise Back changes one and not the other.
    expect(screen.queryByRole('heading', { level: 1, name: 'You are booked' })).toBeNull()
    // And the credential the confirmation told them to keep is still one click
    // away rather than gone with the screen.
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute(
      'href',
      `/booking/${TOKEN}`,
    )
  })

  it('never renders a countdown for a booking with no expiresAt', async () => {
    const user = userEvent.setup()
    handlers.booking = () => confirmedBooking(slot.start)
    renderAt(detailsPath)
    await book(user)

    await screen.findByRole('heading', { level: 1, name: 'You are booked' })
    // `expiresAt` is omitted on a CONFIRMED booking, and a countdown that
    // assumed it exists renders NaN.
    expect(screen.queryByText(/held until/)).not.toBeInTheDocument()
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument()
  })
})

describe('the ways a booking does not work', () => {
  const slot = slotAt(MONDAY, '09:35')
  const other = slotAt(MONDAY, '14:05')
  const detailsPath = `/b/${SLUG}/book?service=${COULEUR.id}&staff=anyone&date=${MONDAY}&slot=${encodeURIComponent(slot.start)}`

  beforeEach(() => {
    handlers.staff = () => [AMELIE, CAMILLE]
    handlers.availability = () => [slot, other]
  })

  async function attempt(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText('Your name'), 'Camille Doe')
    await user.type(screen.getByLabelText('Email'), 'camille@example.test')
    await user.click(screen.getByRole('button', { name: 'Confirm booking' }))
  }

  it('409 BOOKING_SLOT_TAKEN returns to the picker with the details intact', async () => {
    const user = userEvent.setup()
    handlers.booking = problemWith(409, 'BOOKING_SLOT_TAKEN', {
      staffId: AMELIE.id,
      startsAt: slot.start,
      endsAt: slot.end,
    })
    const router = renderAt(detailsPath)
    await attempt(user)

    // The expected outcome of the whole double-booking guarantee, worded as an
    // ordinary thing that happened rather than as a crash.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That time was taken while you were filling this in',
    )
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).has('slot')).toBe(false),
    )
    expect(await screen.findByRole('heading', { level: 1, name: 'When suits you?' })).toBeVisible()

    // The gate item: what was typed survives the return. Forward again, and it
    // is still there — because the form outlives the step.
    // `find`, not `get`: this render is the first time the picker has been
    // mounted in this test, so the week is still in flight.
    await user.click(await screen.findByRole('button', { name: /^14:05/ }))
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByLabelText('Your name')).toHaveValue('Camille Doe')
    expect(screen.getByLabelText('Email')).toHaveValue('camille@example.test')
  })

  it('422 POLICY_LEAD_TIME moves the picker to the earliest day the server named', async () => {
    const user = userEvent.setup()
    const earliest = slotAt(addDays(MONDAY, 2), '10:00').start
    handlers.booking = problemWith(422, 'POLICY_LEAD_TIME', { earliestStart: earliest })
    const router = renderAt(detailsPath)
    await attempt(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That is sooner than this business takes bookings',
    )
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('date')).toBe(
        addDays(MONDAY, 2),
      ),
    )
  })

  it('422 SERVICE_INACTIVE goes back to the catalogue and says why', async () => {
    const user = userEvent.setup()
    handlers.booking = problemWith(422, 'SERVICE_INACTIVE')
    const router = renderAt(detailsPath)
    await attempt(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('That service is no longer bookable')
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).has('service')).toBe(false),
    )
    // Awaited rather than read synchronously off the line above: the router's
    // own state is updated before React has committed the render that follows
    // it, so a plain `getBy` here asserts against the step the customer has
    // just left whenever the machine is busy enough.
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What are you booking?' }),
    ).toBeVisible()
  })

  it('drops the SERVICE_INACTIVE banner once another service is chosen', async () => {
    const user = userEvent.setup()
    handlers.booking = problemWith(422, 'SERVICE_INACTIVE')
    renderAt(detailsPath)
    await attempt(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('That service is no longer bookable')
    // The recovery this failure asked for. It cleared the slot as well as the
    // service, so a rule that watched only the slot would never see it happen —
    // and the sentence would stay pinned above the steps of a service it was
    // never about.
    await user.click(await screen.findByRole('link', { name: new RegExp(COUPE.name) }))

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('429 keeps the customer where they are, with real copy', async () => {
    const user = userEvent.setup()
    handlers.booking = problemWith(429, 'RATE_LIMITED', { retryAfterSeconds: 45 })
    renderAt(detailsPath)
    await attempt(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many booking attempts from here')
    // From retryAfterSeconds, so it is a number somebody can act on.
    expect(alert).toHaveTextContent('45 seconds')
    // Not sent back a step: nothing about the slot was wrong.
    expect(screen.getByRole('heading', { level: 1, name: 'Who is this for?' })).toBeVisible()
    expect(screen.getByLabelText('Your name')).toHaveValue('Camille Doe')
  })

  it('lands a 422 errors[] entry on the field it names', async () => {
    const user = userEvent.setup()
    handlers.booking = problemWith(422, 'VALIDATION_FAILED', {
      errors: [{ field: 'guestName', message: 'must not be blank' }],
    })
    renderAt(detailsPath)
    await attempt(user)

    // `guestName` is a field this form owns, so the message on it is the
    // dictionary's rather than Bean Validation's English (`messageFor`).
    expect(await screen.findByText(en.errors.fieldName)).toBeVisible()
    expect(screen.getByLabelText('Your name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('surfaces a 422 about a field this form does not have', async () => {
    const user = userEvent.setup()
    // `startsAt` is not an input anybody can see. React Hook Form accepts
    // setError on a path it does not know without complaint, so without the
    // unmatched list this message would vanish and leave a form with no errors
    // on it that refuses to submit.
    handlers.booking = problemWith(422, 'VALIDATION_FAILED', {
      errors: [{ field: 'startsAt', message: 'must not be null' }],
    })
    renderAt(detailsPath)
    await attempt(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('startsAt')
    expect(alert).toHaveTextContent('must not be null')
  })
})
