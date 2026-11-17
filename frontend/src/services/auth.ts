/**
 * Accounts API client for backend/apps/users (contract: docs/SPEC.md §5).
 *
 * Auth uses Django's session cookie, which the browser stores and sends by
 * itself. This module only has to:
 *   1. send requests same-origin with cookies (`credentials: 'same-origin'`),
 *   2. add the `X-CSRFToken` header on writes, copied from the `csrftoken`
 *      cookie (fetched once from GET /auth/csrf if it isn't there yet),
 *   3. turn backend replies into values, or an ApiError the UI can show.
 */
import { API_URL } from './api'

/** An account as the backend returns it. Never contains the password. */
export interface User {
  readonly id: number
  readonly username: string
}

/** Per-field messages from a DRF 400 reply, e.g. `{ username: ['Taken.'] }`. */
export type FieldErrors = Readonly<Record<string, readonly string[]>>

/**
 * A request that failed. `status` is the HTTP status, or 0 when the server
 * could not be reached at all. `message` is safe to show to the player.
 */
export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: FieldErrors

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

const CSRF_COOKIE = 'csrftoken'
const NETWORK_ERROR = 'Cannot reach the server. Is the backend running?'

/** Reads one cookie's value, or null. `cookies` is injectable for tests. */
export function readCookie(name: string, cookies: string = document.cookie): string | null {
  for (const part of cookies.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

type Method = 'GET' | 'POST'

/**
 * Sends one request to `${API_URL}${path}` and returns the parsed JSON body
 * (null for empty replies such as 204). Throws ApiError on any failure.
 */
async function request(method: Method, path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json'
    headers['X-CSRFToken'] = await csrfToken()
  }

  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only rejects when no HTTP reply arrived (server down, offline, ...).
    throw new ApiError(0, NETWORK_ERROR)
  }

  const data = await readJson(response)
  if (!response.ok) throw toApiError(response.status, data)
  return data
}

/** The CSRF token from the cookie; asks the backend to set it if missing. */
async function csrfToken(): Promise<string> {
  const existing = readCookie(CSRF_COOKIE)
  if (existing) return existing
  await request('GET', '/auth/csrf')
  return readCookie(CSRF_COOKIE) ?? ''
}

/** Parses the body as JSON; empty or non-JSON bodies become null. */
async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * DRF error bodies come in two shapes:
 *   { detail: "..." }                      general error (bad login, 403, 429)
 *   { username: ["..."], password: [...] } field validation errors
 * The first message found becomes the ApiError message.
 */
function toApiError(status: number, data: unknown): ApiError {
  const fallback = `Request failed (${status}).`
  if (typeof data !== 'object' || data === null) return new ApiError(status, fallback)

  const record = data as Record<string, unknown>
  if (typeof record.detail === 'string') return new ApiError(status, record.detail)

  const fieldErrors: Record<string, readonly string[]> = {}
  for (const [field, value] of Object.entries(record)) {
    if (Array.isArray(value)) fieldErrors[field] = value.map(String)
  }
  const first = Object.values(fieldErrors)[0]?.[0]
  return new ApiError(status, first ?? fallback, fieldErrors)
}

/** Narrows an unknown JSON value to a User, or throws. */
function toUser(data: unknown): User {
  const record = (data ?? {}) as Record<string, unknown>
  if (typeof record.id !== 'number' || typeof record.username !== 'string') {
    throw new ApiError(0, 'Unexpected reply from the server.')
  }
  return { id: record.id, username: record.username }
}

/** Current account, or null when nobody is signed in (backend answers 403). */
export async function fetchMe(): Promise<User | null> {
  try {
    return toUser(await request('GET', '/auth/me'))
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return null
    throw error
  }
}

/** Signs in; the backend sets the session cookie. */
export async function login(username: string, password: string): Promise<User> {
  return toUser(await request('POST', '/auth/login', { username, password }))
}

/** Creates an account and signs it in straight away. */
export async function register(username: string, password: string): Promise<User> {
  return toUser(await request('POST', '/auth/register', { username, password }))
}

/** Ends the session (backend answers 204). */
export async function logout(): Promise<void> {
  await request('POST', '/auth/logout')
}
