// @vitest-environment jsdom
/**
 * Accounts API client: request shape (credentials, CSRF header), and how
 * backend answers (200 / 204 / 400 / 403 / network failure) are turned into
 * values or ApiErrors. `fetch` is replaced with a fake; no server needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchMe, login, logout, readCookie, register } from './auth'

/** Builds a minimal fetch Response stand-in. */
function reply(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => (body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(body)),
  } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  document.cookie = 'csrftoken=tok123'
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
})

describe('readCookie', () => {
  it('finds a cookie among several', () => {
    expect(readCookie('csrftoken', 'a=1; csrftoken=xyz; b=2')).toBe('xyz')
  })

  it('returns null when missing', () => {
    expect(readCookie('csrftoken', 'a=1')).toBeNull()
  })
})

describe('login', () => {
  it('POSTs JSON with the CSRF header and same-origin cookies', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: 1, username: 'kevin' }))

    const user = await login('kevin', 'pw')

    expect(user).toEqual({ id: 1, username: 'kevin' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/api\/auth\/login$/)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    expect(init.headers['X-CSRFToken']).toBe('tok123')
    expect(JSON.parse(init.body)).toEqual({ username: 'kevin', password: 'pw' })
  })

  it('fetches the CSRF cookie first when it is missing', async () => {
    document.cookie = 'csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT'
    fetchMock.mockImplementationOnce(async () => {
      document.cookie = 'csrftoken=fresh' // what the real /csrf response does
      return reply(200, { detail: 'CSRF cookie set.' })
    })
    fetchMock.mockResolvedValueOnce(reply(200, { id: 1, username: 'kevin' }))

    await login('kevin', 'pw')

    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/csrf$/)
    expect(fetchMock.mock.calls[1][1].headers['X-CSRFToken']).toBe('fresh')
  })

  it('turns a 400 detail into an ApiError message', async () => {
    fetchMock.mockResolvedValueOnce(reply(400, { detail: 'Invalid username or password.' }))

    const error = await login('kevin', 'bad').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(400)
    expect((error as ApiError).message).toBe('Invalid username or password.')
  })

  it('reports an unreachable server as status 0', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const error = (await login('kevin', 'pw').catch((e: unknown) => e)) as ApiError

    expect(error.status).toBe(0)
    expect(error.message).toMatch(/reach the server/)
  })
})

describe('register', () => {
  it('keeps per-field errors from the backend', async () => {
    fetchMock.mockResolvedValueOnce(
      reply(400, { username: ['A user with that username already exists.'], password: ['Too short.'] }),
    )

    const error = (await register('kevin', 'x').catch((e: unknown) => e)) as ApiError

    expect(error.fieldErrors.username).toEqual(['A user with that username already exists.'])
    expect(error.fieldErrors.password).toEqual(['Too short.'])
    expect(error.message).toBe('A user with that username already exists.')
  })

  it('returns the new user on 201', async () => {
    fetchMock.mockResolvedValueOnce(reply(201, { id: 7, username: 'kiana' }))
    expect(await register('kiana', 'pw')).toEqual({ id: 7, username: 'kiana' })
  })
})

describe('fetchMe', () => {
  it('returns the user when logged in', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { id: 1, username: 'kevin' }))
    expect(await fetchMe()).toEqual({ id: 1, username: 'kevin' })
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
  })

  it('returns null when logged out (403)', async () => {
    fetchMock.mockResolvedValueOnce(reply(403, { detail: 'Authentication credentials were not provided.' }))
    expect(await fetchMe()).toBeNull()
  })

  it('throws on other failures', async () => {
    fetchMock.mockResolvedValueOnce(reply(500))
    await expect(fetchMe()).rejects.toBeInstanceOf(ApiError)
  })
})

describe('logout', () => {
  it('accepts an empty 204 reply', async () => {
    fetchMock.mockResolvedValueOnce(reply(204))
    await expect(logout()).resolves.toBeUndefined()
  })
})
