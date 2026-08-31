import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import axe from 'axe-core'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetBootstrap } from '@/api/bootstrap'
import { client, resetInFlightRefresh } from '@/api/client'
import { createQueryClient } from '@/api/query-client'
import { endSessionQuietly } from '@/api/session'
import { AuthProvider } from '@/features/auth/auth-provider'
import { routes } from '@/routes'

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}))

/**
 * The settings screen, and the one interaction on it that must not be
 * simplified.
 *
 * **`confirmShift` is never sent on a first attempt.** The `409
 * TIMEZONE_SHIFT_UNCONFIRMED` is the only warning an owner gets before every
 * future slot moves, and a client that pre-empted the flag — or that retried
 * automatically on the refusal — would remove the conversation the endpoint
 * exists to have while still appearing to work. Nothing about that is visible in
 * a screenshot, so it is asserted here: the body of the first `PUT` is checked
 * for the absence of the field, and the second for its presence.
 *
 * The rest is the other two gate items. `slotGranularityMinutes` cannot be set
 * to a value the API would reject, because the control is a select over the six
 * it accepts. And the deposit note tells the truth about a percentage of zero.
 */

const OWNER_SESSION = {
  id: '55555555-5555-5555-5555-555555555555',
  email: 'demo@slotflow.app',
  fullName: 'Camille Bérard',
  role: 'OWNER' as 'OWNER' | 'STAFF',
  business: {
    id: '66666666-6666-6666-6666-666666666666',
    slug: 'demo-salon',
    name: 'Belle Époque',
    timezone: 'Europe/Paris',
    currency: 'EUR',
  },
}

const STAFF_SESSION = { ...OWNER_SESSION, role: 'STAFF' as const }

const BUSINESS = {
  id: OWNER_SESSION.business.id,
  slug: 'demo-salon',
  name: 'Belle Époque',
  timezone: 'Europe/Paris',
  currency: 'EUR',
  depositRequired: true,
  depositPercent: 30,
}

const POLICY = {
  minLeadTimeHours: 2,
  maxAdvanceDays: 60,
  cancellationCutoffHours: 24,
  slotGranularityMinutes: 15,
  updatedAt: '2026-08-01T09:00:00Z',
}

// --- the stub API ----------------------------------------------------------

let session = OWNER_SESSION
let business = BUSINESS
let policy = POLICY
let requests: AxiosRequestConfig[] = []
let businessStatus = 200

function callsTo(method: string, path: string): AxiosRequestConfig[] {
  return requests.filter(
    (config) => (config.method ?? 'get').toLowerCase() === method && (config.url ?? '') === path,
  )
}

function bodyOf(config: AxiosRequestConfig | undefined): Record<string, unknown> {
  return JSON.parse(String(config?.data ?? '{}'))
}

/**
 * The timezone rule, stubbed the way the server actually behaves rather than as
 * a canned 409: a body that moves the zone without the flag is refused, and the
 * same body with it goes through. A stub that always refused would let a screen
 * that never sends the flag pass this file.
 */
function stubApi() {
  const adapter: AxiosAdapter = (config: AxiosRequestConfig) => {
    const url = config.url ?? ''
    const method = (config.method ?? 'get').toLowerCase()
    requests.push(config)

    let data: unknown = null
    let status = 200

    if (url === '/api/auth/refresh') {
      data = { accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user: session }
    } else if (url === '/api/auth/me') {
      data = session
    } else if (url === '/api/business' && method === 'put') {
      const sent = bodyOf(config) as { timezone: string; confirmShift?: boolean }
      if (sent.timezone !== business.timezone && sent.confirmShift !== true) {
        status = 409
        data = {
          code: 'TIMEZONE_SHIFT_UNCONFIRMED',
          detail: 'Changing the timezone moves every future slot.',
          currentTimezone: business.timezone,
          requestedTimezone: sent.timezone,
          affectedBookings: 7,
        }
      } else {
        business = { ...business, ...(sent as Partial<typeof BUSINESS>) }
        session = { ...session, business: { ...session.business, timezone: business.timezone } }
        data = business
      }
    } else if (url === '/api/policy' && method === 'put') {
      policy = { ...policy, ...bodyOf(config) }
      data = policy
    } else if (url === '/api/business') {
      if (businessStatus >= 400) {
        status = businessStatus
        data = { code: 'INTERNAL_ERROR', detail: 'Settings are having a moment.' }
      } else {
        data = business
      }
    } else if (url === '/api/policy') {
      data = policy
    }

    if (status >= 400) {
      return Promise.reject(
        Object.assign(new Error('stub failure'), {
          isAxiosError: true,
          config,
          response: { status, data, headers: {}, config },
        }),
      ) as ReturnType<AxiosAdapter>
    }

    return Promise.resolve({
      data,
      status,
      statusText: 'OK',
      headers: {},
      config: config as AxiosResponse['config'],
    }) as ReturnType<AxiosAdapter>
  }

  client.defaults.adapter = adapter
}

function mount(path = '/settings') {
  const queryClient = createQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  )
  return { router, queryClient }
}

async function renderSettings() {
  stubApi()
  const mounted = mount()
  await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByLabelText('Slot step')).toBeInTheDocument())
  return mounted
}

beforeEach(() => {
  session = OWNER_SESSION
  business = BUSINESS
  policy = POLICY
  requests = []
  businessStatus = 200
})

afterEach(() => {
  vi.clearAllMocks()
  endSessionQuietly()
  resetBootstrap()
  resetInFlightRefresh()
  client.defaults.adapter = undefined
})

describe('the business settings', () => {
  it('loads what is stored, slug included and not editable', async () => {
    await renderSettings()

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Belle Époque')
    expect((screen.getByLabelText('Booking page address') as HTMLInputElement).value).toBe(
      '/b/demo-salon',
    )
    expect(screen.getByLabelText('Booking page address')).toBeDisabled()
  })

  it('saves a rename without asking anything, and never sends confirmShift', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Belle Epoque')
    await user.click(screen.getByRole('button', { name: 'Save business settings' }))

    await waitFor(() => expect(callsTo('put', '/api/business')).toHaveLength(1))
    expect(bodyOf(callsTo('put', '/api/business')[0])).not.toHaveProperty('confirmShift')
    expect(screen.queryByText(/move the business to/i)).toBeNull()
  })

  it('says the currency reinterprets prices rather than converting them', async () => {
    await renderSettings()

    expect(screen.getByText(/reinterprets them and converts nothing/i)).toBeInTheDocument()
  })

  it('is honest that a deployment without payments takes no deposit', async () => {
    await renderSettings()

    expect(
      screen.getByText(/deposits are taken only when payments are configured/i),
    ).toBeInTheDocument()
  })

  it('says a percentage of zero means no deposit, whatever the checkbox says', async () => {
    const user = userEvent.setup()
    await renderSettings()

    expect(screen.queryByText(/whatever the checkbox says/i)).toBeNull()

    await user.clear(screen.getByLabelText('Deposit percentage'))
    await user.type(screen.getByLabelText('Deposit percentage'), '0')

    expect(await screen.findByText(/whatever the checkbox says/i)).toBeInTheDocument()
  })
})

describe('the timezone, which is a two-step conversation', () => {
  async function changeZone(to = 'Europe/Lisbon') {
    const user = userEvent.setup()
    await renderSettings()

    await user.clear(screen.getByLabelText('Timezone'))
    await user.type(screen.getByLabelText('Timezone'), to)
    await user.click(screen.getByRole('button', { name: 'Save business settings' }))
    return user
  }

  /** The gate item, in the only form that can catch the mistake. */
  it('sends the first attempt without confirmShift and lets the 409 be the prompt', async () => {
    await changeZone()

    await waitFor(() => expect(callsTo('put', '/api/business')).toHaveLength(1))
    const first = bodyOf(callsTo('put', '/api/business')[0])
    expect(first).not.toHaveProperty('confirmShift')
    expect(first.timezone).toBe('Europe/Lisbon')
  })

  it('names both zones and the number of bookings in the dialog', async () => {
    await changeZone()

    expect(await screen.findByText(/Move the business to Europe\/Lisbon\?/)).toBeInTheDocument()
    expect(screen.getByText('Europe/Paris')).toBeInTheDocument()
    expect(screen.getByText(/7 future appointments/)).toBeInTheDocument()
    expect(screen.getByText(/keeps its wall-clock time in the new zone/i)).toBeInTheDocument()
  })

  it('does not resubmit on its own — the second request only happens on confirm', async () => {
    const user = await changeZone()
    await screen.findByText(/Move the business to Europe\/Lisbon\?/)

    // The refusal has landed and nothing has followed it.
    expect(callsTo('put', '/api/business')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Move to Europe/Lisbon' }))

    await waitFor(() => expect(callsTo('put', '/api/business')).toHaveLength(2))
    expect(bodyOf(callsTo('put', '/api/business')[1])).toMatchObject({
      timezone: 'Europe/Lisbon',
      confirmShift: true,
    })
  })

  it('leaves the zone alone when the owner backs out', async () => {
    const user = await changeZone()
    await screen.findByText(/Move the business to Europe\/Lisbon\?/)

    await user.click(screen.getByRole('button', { name: 'Keep Europe/Paris' }))

    await waitFor(() => expect(screen.queryByText(/Move the business to/)).toBeNull())
    expect(callsTo('put', '/api/business')).toHaveLength(1)
  })

  /**
   * The session's `business` is React state in `AuthProvider`, not query state,
   * so no invalidation reaches it — and it is what every admin screen draws its
   * days in. Without the re-read the calendar keeps the old zone until a reload.
   */
  it('re-reads the session so the rest of the app moves with it', async () => {
    const user = await changeZone()
    await screen.findByText(/Move the business to Europe\/Lisbon\?/)
    const before = callsTo('get', '/api/auth/me').length

    await user.click(screen.getByRole('button', { name: 'Move to Europe/Lisbon' }))

    await waitFor(() => expect(callsTo('get', '/api/auth/me').length).toBeGreaterThan(before))
  })
})

describe('the booking policy', () => {
  it('offers only the six steps the API accepts', async () => {
    await renderSettings()

    const select = screen.getByLabelText('Slot step') as HTMLSelectElement
    expect(select.tagName).toBe('SELECT')
    expect([...select.options].map((option) => option.value)).toEqual([
      '5',
      '10',
      '15',
      '20',
      '30',
      '60',
    ])
  })

  it('says the four numbers back as one sentence, live', async () => {
    await renderSettings()

    expect(
      screen.getByText(
        'Customers can book from 2 hours ahead up to 60 days out, in 15-minute steps.',
      ),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Slot step'), { target: { value: '30' } })

    expect(
      await screen.findByText(
        'Customers can book from 2 hours ahead up to 60 days out, in 30-minute steps.',
      ),
    ).toBeInTheDocument()
  })

  it('saves the four numbers as numbers, not as the strings an input holds', async () => {
    const user = userEvent.setup()
    await renderSettings()

    fireEvent.change(screen.getByLabelText('Slot step'), { target: { value: '30' } })
    await user.click(screen.getByRole('button', { name: 'Save booking rules' }))

    await waitFor(() => expect(callsTo('put', '/api/policy')).toHaveLength(1))
    expect(bodyOf(callsTo('put', '/api/policy')[0])).toEqual({
      minLeadTimeHours: 2,
      maxAdvanceDays: 60,
      cancellationCutoffHours: 24,
      slotGranularityMinutes: 30,
    })
  })

  it('refuses a booking window the API would refuse, before the round trip', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await user.clear(screen.getByLabelText('Booking window (days)'))
    await user.type(screen.getByLabelText('Booking window (days)'), '400')
    await user.click(screen.getByRole('button', { name: 'Save booking rules' }))

    expect(await screen.findByText('Between 1 and 365')).toBeInTheDocument()
    expect(callsTo('put', '/api/policy')).toHaveLength(0)
  })

  it('does not claim that changing the step moves anything already booked', async () => {
    await renderSettings()

    expect(
      screen.getByText(/does not move appointments that are already booked/i),
    ).toBeInTheDocument()
  })
})

describe('the three states', () => {
  it('says so with a retry when the settings cannot be read', async () => {
    businessStatus = 500
    stubApi()
    mount()

    // A 5xx is retried twice before it settles (`shouldRetry`), so the error
    // state exists three round trips in — comfortably inside the async-query
    // budget `vitest.setup.ts` sets, and well outside Testing Library's default.
    expect(
      await screen.findByText('Your business settings could not be loaded'),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0)
    // The other half still loaded — two resources, two independent surfaces.
    expect(screen.getByLabelText('Slot step')).toBeInTheDocument()
  })
})

describe('who may see this screen', () => {
  it('sends a staff member away rather than showing them an owner-only form', async () => {
    session = STAFF_SESSION
    stubApi()
    const { router } = mount()

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(callsTo('get', '/api/business')).toHaveLength(0)
  })
})

describe('axe', () => {
  /** `color-contrast` off and only that rule — jsdom cannot run it. */
  const options = { rules: { 'color-contrast': { enabled: false } } } as const

  it('reports nothing on both forms', async () => {
    await renderSettings()

    const main = document.querySelector('main')
    if (!main) throw new Error('no main')
    const result = await axe.run(main, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })

  it('reports nothing on the timezone confirmation', async () => {
    const user = userEvent.setup()
    await renderSettings()

    await user.clear(screen.getByLabelText('Timezone'))
    await user.type(screen.getByLabelText('Timezone'), 'Europe/Lisbon')
    await user.click(screen.getByRole('button', { name: 'Save business settings' }))

    const dialog = await screen.findByRole('alertdialog')
    const result = await axe.run(dialog, options)
    expect(result.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([])
  })
})
