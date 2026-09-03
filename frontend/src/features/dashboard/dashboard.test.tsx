import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { NOT_ENOUGH_DATA } from '@/features/dashboard/figures'
import { daysBetween, weekdayOf } from '@/lib/time'
import { routes } from '@/routes'
import { en } from '@/i18n/en'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The dashboard, and mostly the things it must not say.
 *
 * Three of the gate items for this wave are about a number being rendered
 * *honestly* rather than being rendered at all, and every one of them looks
 * completely fine on screen when it is wrong:
 *
 * - `noShowRate: null` printed as "0%" tells an owner they have a perfect record
 *   when what they have is no data.
 * - A tile labelled "Revenue" over a `COMPLETED`-only sum reads as the week's
 *   takings and is short by every appointment still to come.
 * - A booking naming an archived service renders with a gap where a name should
 *   be, which looks like a rendering bug rather than a filtered fetch.
 *
 * So they are asserted from fixtures, including by looking for copy that has to
 * be absent.
 */

const SERVICE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Coupe classique',
  description: 'Wash, cut and finish.',
  durationMinutes: 30,
  priceCents: 3500,
  bufferBeforeMinutes: 5,
  bufferAfterMinutes: 5,
  totalBlockMinutes: 40,
  active: true,
  bookable: true,
  staffIds: [],
}

/** Archived. A booking from March still names it. */
const ARCHIVED_SERVICE = {
  ...SERVICE,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Permanente',
  active: false,
  bookable: false,
}

const STAFF = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'amelie@slotflow.app',
  fullName: 'Amélie Rousseau',
  role: 'STAFF' as const,
  active: true,
  accepted: true,
  invitationPending: false,
  serviceIds: [],
}

/** Deactivated, and still the person who took the appointment. */
const FORMER_STAFF = {
  ...STAFF,
  id: '44444444-4444-4444-4444-444444444444',
  email: 'marc@slotflow.app',
  fullName: 'Marc Lefèvre',
  active: false,
}

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

const AMELIE = { ...OWNER, id: STAFF.id, fullName: STAFF.fullName, role: 'STAFF' as const }

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: '77777777-7777-7777-7777-777777777777',
    serviceId: SERVICE.id,
    staffId: STAFF.id,
    guestName: 'Yasmine Haddad',
    startsAt: '2026-09-01T08:00:00Z',
    endsAt: '2026-09-01T08:30:00Z',
    status: 'CONFIRMED',
    priceCents: 3500,
    ...overrides,
  }
}

function stats(overrides: Record<string, unknown> = {}) {
  return {
    todayBookings: 3,
    weekBookings: 9,
    revenueCents: 26300,
    depositsCents: 10620,
    noShowRate: 0.0435,
    upcoming: [booking()],
    ...overrides,
  }
}

let statsBody: unknown
let statsRequests: AxiosRequestConfig[] = []

function stubApi(user: typeof OWNER | typeof AMELIE) {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    const url = config.url ?? ''
    let data: unknown = user

    if (url === '/api/auth/refresh') {
      data = { accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user }
    } else if (url.includes('/api/dashboard/stats')) {
      statsRequests.push(config)
      data = statsBody
    } else if (url.includes('/api/services')) {
      data = {
        content: [SERVICE, ARCHIVED_SERVICE],
        page: 0,
        size: 100,
        totalElements: 2,
        totalPages: 1,
      }
    } else if (url.includes('/api/staff')) {
      data = [STAFF, FORMER_STAFF]
    }

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

function mount(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return router
}

async function renderDashboard(user: typeof OWNER | typeof AMELIE = OWNER, path = '/dashboard') {
  stubApi(user)
  const router = mount(path)
  await waitFor(() => expect(screen.queryByText('Restoring your session')).not.toBeInTheDocument())
  return router
}

/** The band alone, so an assertion about it cannot be satisfied from elsewhere. */
function figures() {
  // `region`, because a <section> with an accessible name is one.
  return screen.getByRole('region', { name: /figures for the week shown/i })
}

beforeEach(() => {
  statsBody = stats()
  statsRequests = []
  resetInFlightRefresh()
  resetBootstrap()
  endSessionQuietly()
})

describe('the figures', () => {
  it('renders "Not enough data" and never a zero for a null no-show rate', async () => {
    statsBody = stats({ noShowRate: null })
    await renderDashboard()

    // `NOT_ENOUGH_DATA` is a dictionary key from wave 10, so this asserts the
    // sentence the band actually draws rather than the key that chose it.
    expect(await screen.findByText(en.dashboard.figures.notEnoughData)).toBeInTheDocument()
    // The whole reason the API sends null rather than 0. A percentage anywhere
    // in the band would mean the client reintroduced the lie at the last step.
    expect(within(figures()).queryByText(/%$/)).not.toBeInTheDocument()
  })

  it('renders a real rate as a percentage, to one decimal place', async () => {
    statsBody = stats({ noShowRate: 0.0435 })
    await renderDashboard()

    // Four decimal places arrive. A dashboard printing 4.35% claims a precision
    // that two integers and a division do not have.
    expect(await screen.findByText('4.4%')).toBeInTheDocument()
    expect(screen.queryByText(NOT_ENOUGH_DATA)).not.toBeInTheDocument()
  })

  it('never labels a COMPLETED-only sum "Revenue"', async () => {
    await renderDashboard()

    expect(await screen.findByText('Revenue earned')).toBeInTheDocument()
    // Unqualified, it reads as the week's takings and is short by every
    // appointment still to come.
    expect(screen.queryByText('Revenue')).not.toBeInTheDocument()
    expect(within(figures()).getByText(/Completed appointments only/)).toBeInTheDocument()
  })

  it('prints what each figure counts, not just the figure', async () => {
    await renderDashboard()

    await screen.findByText('Revenue earned')
    const band = within(figures())
    expect(band.getByText('Deposits held')).toBeInTheDocument()
    expect(band.getByText(/Cancellations never count/)).toBeInTheDocument()
    // todayBookings ignores from/to, and the tile says so rather than leaving it
    // to be discovered by paging back a fortnight.
    expect(band.getByText(/whichever week is shown/)).toBeInTheDocument()
  })

  it('formats money in the business currency', async () => {
    await renderDashboard()

    // 26300 minor units of EUR. Never cents / 100, and never a hard-coded euro.
    expect(await screen.findByText(/263[.,]00/)).toBeInTheDocument()
  })

  it('shows the labels and definitions while the figures are still loading', async () => {
    // Zero layout shift is structural here: the label and the definition are
    // static copy and render throughout, so the only thing that changes when
    // data lands is what sits in a fixed-height value slot.
    stubApi(OWNER)
    mount('/dashboard')

    expect(await screen.findByText('Revenue earned')).toBeInTheDocument()
    expect(screen.getByText(/Completed appointments only/)).toBeInTheDocument()
  })
})

describe('the upcoming list', () => {
  it('renders names for an archived service and a colleague who has left', async () => {
    statsBody = stats({
      upcoming: [booking({ serviceId: ARCHIVED_SERVICE.id, staffId: FORMER_STAFF.id })],
    })
    await renderDashboard()

    // Both rows are inactive. Neither list is filtered, which is why this row
    // has two names on it rather than two gaps.
    expect(await screen.findByText('Permanente · Marc Lefèvre')).toBeInTheDocument()
  })

  it('offers a next action when there is nothing scheduled', async () => {
    statsBody = stats({ upcoming: [] })
    await renderDashboard()

    expect(await screen.findByText('No appointments scheduled')).toBeInTheDocument()
    // An empty dashboard's next action is to get a booking, and this is the link
    // a reviewer clicks.
    expect(screen.getByRole('link', { name: 'Open the booking page' })).toHaveAttribute(
      'href',
      '/b/belle-epoque',
    )
  })

  it('links each row to its own day in the calendar', async () => {
    await renderDashboard()

    const row = await screen.findByRole('link', { name: /Yasmine Haddad/ })
    // 08:00 UTC is 10:00 in Paris on the same date. The day is the business's,
    // never the viewer's.
    expect(row).toHaveAttribute('href', '/calendar?date=2026-09-01')
  })

  it('waits for the lookups rather than flashing ids', async () => {
    await renderDashboard()

    await screen.findByText('Yasmine Haddad')
    expect(screen.queryByText(new RegExp(SERVICE.id))).not.toBeInTheDocument()
  })
})

describe('the week', () => {
  it('asks for a Monday-to-Sunday range with both ends inclusive, in the business zone', async () => {
    await renderDashboard()
    await screen.findByText('Revenue earned')

    const params = statsRequests[0]?.params as { from: string; to: string; tz: string }
    expect(weekdayOf(params.from)).toBe('MONDAY')
    // Six, not seven. /api/bookings takes an exclusive `to` and this endpoint
    // takes an inclusive one; getting them the same way round is a silently
    // wrong week rather than an error.
    expect(daysBetween(params.from, params.to)).toBe(6)
    // Sent explicitly even though the API defaults to it, so the request states
    // the assumption the screen renders under (F8).
    expect(params.tz).toBe('Europe/Paris')
  })

  it('moves a whole week back and refetches for that range', async () => {
    const user = userEvent.setup()
    await renderDashboard()
    await screen.findByText('Revenue earned')

    const first = statsRequests[0]?.params as { from: string }
    await user.click(screen.getByRole('button', { name: 'Previous week' }))

    await waitFor(() => expect(statsRequests.length).toBeGreaterThan(1))
    const second = statsRequests.at(-1)?.params as { from: string; to: string }
    // daysBetween is signed and reads a -> b, so the earlier Monday is seven
    // days behind the one that was showing.
    expect(daysBetween(second.from, first.from)).toBe(7)
    expect(daysBetween(second.from, second.to)).toBe(6)
  })

  it('keeps the shown week in the URL so a range can be sent to somebody', async () => {
    const user = userEvent.setup()
    const router = await renderDashboard()
    await screen.findByText('Revenue earned')

    await user.click(screen.getByRole('button', { name: 'Previous week' }))

    await waitFor(() => expect(router.state.location.search).toMatch(/week=\d{4}-\d{2}-\d{2}/))
    // And a way back, which only appears when it would do something.
    expect(screen.getByRole('button', { name: 'This week' })).toBeInTheDocument()
  })

  it('opens on the week a ?week= names, from any day inside it', async () => {
    // A Thursday. The picker normalises to its Monday rather than refusing.
    await renderDashboard(OWNER, '/dashboard?week=2026-09-03')
    await screen.findByText('Revenue earned')

    const params = statsRequests[0]?.params as { from: string; to: string }
    expect(params.from).toBe('2026-08-31')
    expect(params.to).toBe('2026-09-06')
  })
})

describe('whose figures these are', () => {
  it('names the business for an owner', async () => {
    await renderDashboard(OWNER)

    expect(await screen.findByText('Every appointment at Belle Époque.')).toBeInTheDocument()
  })

  it('says the numbers are their own for a staff member', async () => {
    // Same endpoint, different numbers, by design (backend plan 13 step 3). The
    // demo is logged into both, and an unexplained difference reads as a bug.
    await renderDashboard(AMELIE)

    expect(await screen.findByText(/Your own appointments/)).toBeInTheDocument()
    expect(screen.queryByText(/Every appointment at/)).not.toBeInTheDocument()
  })
})
