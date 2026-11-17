// @vitest-environment jsdom
/**
 * useAuth: the sign-in state machine. The API client is mocked, so these
 * tests only check state changes: loading → anonymous / authenticated,
 * submitting, and the errors shown to the player.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as auth from '../services/auth'
import { useAuth } from './useAuth'

vi.mock('../services/auth', async (importOriginal) => {
  const real = await importOriginal<typeof auth>()
  return { ...real, fetchMe: vi.fn(), login: vi.fn(), register: vi.fn(), logout: vi.fn() }
})

const KEVIN = { id: 1, username: 'kevin' }

beforeEach(() => {
  vi.mocked(auth.fetchMe).mockResolvedValue(null)
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('useAuth', () => {
  it('starts loading, then is anonymous when nobody is signed in', async () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.state.status).toBe('loading')
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))
    expect(result.current.state.user).toBeNull()
  })

  it('restores an existing session on load', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(KEVIN)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('authenticated'))
    expect(result.current.state.user).toEqual(KEVIN)
  })

  it('shows a message when the backend is unreachable on load', async () => {
    vi.mocked(auth.fetchMe).mockRejectedValue(new auth.ApiError(0, 'Cannot reach the server.'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))
    expect(result.current.state.error).toMatch(/reach the server/)
  })

  it('logs in and stores the user', async () => {
    vi.mocked(auth.login).mockResolvedValue(KEVIN)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))

    await act(() => result.current.login('kevin', 'pw'))

    expect(auth.login).toHaveBeenCalledWith('kevin', 'pw')
    expect(result.current.state).toMatchObject({ status: 'authenticated', user: KEVIN, error: null })
  })

  it('keeps field errors when registration is rejected', async () => {
    vi.mocked(auth.register).mockRejectedValue(
      new auth.ApiError(400, 'Taken.', { username: ['Taken.'] }),
    )
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))

    await act(() => result.current.register('kevin', 'pw'))

    expect(result.current.state).toMatchObject({
      status: 'anonymous',
      isSubmitting: false,
      error: 'Taken.',
      fieldErrors: { username: ['Taken.'] },
    })
  })

  it('logs out', async () => {
    vi.mocked(auth.fetchMe).mockResolvedValue(KEVIN)
    vi.mocked(auth.logout).mockResolvedValue(undefined)
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('authenticated'))

    await act(() => result.current.logout())

    expect(result.current.state).toMatchObject({ status: 'anonymous', user: null })
  })

  it('clearError removes old messages', async () => {
    vi.mocked(auth.login).mockRejectedValue(new auth.ApiError(400, 'Invalid username or password.'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))
    await act(() => result.current.login('kevin', 'bad'))
    expect(result.current.state.error).not.toBeNull()

    act(() => result.current.clearError())

    expect(result.current.state.error).toBeNull()
    expect(result.current.state.fieldErrors).toEqual({})
  })

  it('turns unexpected exceptions into a generic message', async () => {
    vi.mocked(auth.login).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useAuth())
    await waitFor(() => expect(result.current.state.status).toBe('anonymous'))
    await act(() => result.current.login('kevin', 'pw'))
    expect(result.current.state.error).toBe('Something went wrong. Please try again.')
  })
})
