import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { client, refreshSession, resetInFlightRefresh, REFRESH_PATH } from '@/api/client'
import { ApiError } from '@/api/error'
import {
  beginSession,
  endSessionQuietly,
  forgetAccessToken,
  getAccessToken,
  hasSession,
  onSessionEnded,
  type SessionEndReason,
} from '@/api/session'

/**
 * The four subtle lines of the refresh interceptor, one test each. Each name is
 * the failure it prevents rather than the code it covers, because the code is
 * two lines and the failure is an afternoon.
 *
 * A stub adapter rather than MSW: what is under test is the interceptor's own
 * arithmetic — how many refreshes for six 401s, how many replays for a
 * persistent one — and an adapter is where those are countable without a service
 * worker's scheduling in between.
 */

type Handler = (config: AxiosRequestConfig) => Promise<AxiosResponse> | AxiosResponse

let handler: Handler
let requests: string[]

const ME = '/api/auth/me'

function ok(data: unknown, config: AxiosRequestConfig): AxiosResponse {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config: config as AxiosResponse['config'],
  }
}

function problem(status: number, code: string, config: AxiosRequestConfig) {
  const error = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean
    config: unknown
    response: unknown
    toJSON: () => object
  }
  error.isAxiosError = true
  error.config = config
  error.response = {
    status,
    statusText: '',
    data: { status, code, detail: `${code} happened`, type: 'about:blank' },
    headers: { 'x-request-id': 'req-1' },
    config,
  }
  error.toJSON = () => ({})
  return Promise.reject(error)
}

const authBody = (accessToken: string) => ({
  accessToken,
  tokenType: 'Bearer',
  expiresIn: 900,
  user: {
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
  },
})

const adapter: AxiosAdapter = (config) => {
  requests.push(`${(config.method ?? 'get').toUpperCase()} ${config.url}`)
  return Promise.resolve(handler(config)) as ReturnType<AxiosAdapter>
}

beforeEach(() => {
  requests = []
  client.defaults.adapter = adapter
  resetInFlightRefresh()
  endSessionQuietly()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function countOf(path: string) {
  return requests.filter((entry) => entry.endsWith(path)).length
}

describe('the request interceptor', () => {
  it('attaches the in-memory token, and nothing when there is none', async () => {
    const seen: (string | undefined)[] = []
    handler = (config) => {
      seen.push(config.headers?.Authorization as string | undefined)
      return ok({}, config)
    }

    await client.get(ME)
    beginSession('token-1')
    await client.get(ME)

    expect(seen).toEqual([undefined, 'Bearer token-1'])
  })

  it('keeps the token out of every storage a page dump would reveal', async () => {
    beginSession('secret-token')

    expect(getAccessToken()).toBe('secret-token')
    expect(document.cookie).not.toContain('secret-token')
    expect(JSON.stringify(localStorage)).not.toContain('secret-token')
    expect(JSON.stringify(sessionStorage)).not.toContain('secret-token')
  })
})

describe('the response interceptor', () => {
  it('turns a problem body into an ApiError with the code, not the status text', async () => {
    handler = (config) => problem(409, 'SLUG_TAKEN', config)

    const error = await client.post('/api/auth/register', {}).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('SLUG_TAKEN')
    expect((error as ApiError).status).toBe(409)
    // From the header, which is present on every response — not from the body,
    // where `Problems.of` puts it on 5xx only.
    expect((error as ApiError).requestId).toBe('req-1')
  })

  it('three concurrent 401s produce exactly ONE refresh, not three', async () => {
    // The failure this prevents: the backend rotates on every refresh and treats
    // a re-presented token as theft, so a second concurrent call comes back
    // REFRESH_REUSED and revokes the chain — signing the user out at the moment
    // the code was trying to keep them in.
    beginSession('expired')
    forgetAccessToken()

    let refreshes = 0
    handler = (config) => {
      if (config.url === REFRESH_PATH) {
        refreshes += 1
        return ok(authBody('fresh'), config)
      }
      const authorization = config.headers?.Authorization as string | undefined
      if (authorization !== 'Bearer fresh') return problem(401, 'UNAUTHENTICATED', config)
      return ok({ ok: true }, config)
    }

    const responses = await Promise.all([client.get(ME), client.get(ME), client.get(ME)])

    expect(refreshes).toBe(1)
    expect(countOf(REFRESH_PATH)).toBe(1)
    // Three originals, one refresh, three replays.
    expect(countOf(ME)).toBe(6)
    expect(responses.map((response) => response.data)).toEqual([
      { ok: true },
      { ok: true },
      { ok: true },
    ])
    expect(hasSession()).toBe(true)
  })

  it('a 401 on /api/auth/refresh itself does not recurse', async () => {
    beginSession('expired')
    forgetAccessToken()

    handler = (config) =>
      config.url === REFRESH_PATH
        ? problem(401, 'UNAUTHENTICATED', config)
        : problem(401, 'UNAUTHENTICATED', config)

    await expect(client.get(ME)).rejects.toBeInstanceOf(ApiError)

    // One refresh attempt. Without the guard this is unbounded: each refresh's
    // own 401 would trigger another refresh.
    expect(countOf(REFRESH_PATH)).toBe(1)
    expect(hasSession()).toBe(false)
  })

  it('retries once, not twice, on a 401 that survives a fresh token', async () => {
    beginSession('expired')

    handler = (config) =>
      config.url === REFRESH_PATH
        ? ok(authBody('fresh'), config)
        : problem(401, 'UNAUTHENTICATED', config)

    await expect(client.get(ME)).rejects.toBeInstanceOf(ApiError)

    // Original, then one replay. A third would mean the retry marker did not
    // survive Axios's config merge, and the request would loop forever.
    expect(countOf(ME)).toBe(2)
    expect(countOf(REFRESH_PATH)).toBe(1)
  })

  it('reports the ORIGINAL error after a failed refresh, not the refresh failure', async () => {
    // The screen still has to decide what to say, and it decides from `code`.
    beginSession('expired')

    handler = (config) =>
      config.url === REFRESH_PATH
        ? problem(401, 'UNAUTHENTICATED', config)
        : problem(401, 'ACCESS_DENIED', config)

    const error = (await client.get(ME).catch((e: unknown) => e)) as ApiError

    expect(error.code).toBe('ACCESS_DENIED')
    expect(error.cause).toBeInstanceOf(ApiError)
    expect((error.cause as ApiError).code).toBe('UNAUTHENTICATED')
  })

  it('does not convert a cancellation into an error a screen would report', async () => {
    const controller = new AbortController()
    handler = (config) => {
      controller.abort()
      return ok({}, config)
    }

    const error = await client.get(ME, { signal: controller.signal }).catch((e: unknown) => e)

    expect(error).not.toBeInstanceOf(ApiError)
  })
})

describe('ending a session', () => {
  it('says REFRESH_REUSED in its own words, not the generic 401 copy', async () => {
    beginSession('expired')
    const reasons: SessionEndReason[] = []
    const unsubscribe = onSessionEnded((reason) => reasons.push(reason))

    handler = (config) => problem(401, 'REFRESH_REUSED', config)
    await refreshSession().catch(() => undefined)
    unsubscribe()

    expect(reasons).toEqual(['reused'])
  })

  it('stays silent for a first-time visitor whose bootstrap refresh 401s', async () => {
    // No session was ever established, so there is nothing to announce. A toast
    // here is the app greeting a stranger with "your session expired".
    const reasons: SessionEndReason[] = []
    const unsubscribe = onSessionEnded((reason) => reasons.push(reason))

    handler = (config) => problem(401, 'UNAUTHENTICATED', config)
    await refreshSession().catch(() => undefined)
    unsubscribe()

    expect(reasons).toEqual([])
  })

  it('announces an expiry once, however many requests were in flight', async () => {
    beginSession('expired')
    forgetAccessToken()
    const reasons: SessionEndReason[] = []
    const unsubscribe = onSessionEnded((reason) => reasons.push(reason))

    handler = (config) => problem(401, 'UNAUTHENTICATED', config)
    await Promise.allSettled([client.get(ME), client.get(ME), client.get(ME)])
    unsubscribe()

    // One toast, not six. The single-flight refresh is what collapses them.
    expect(reasons).toEqual(['expired'])
  })
})
