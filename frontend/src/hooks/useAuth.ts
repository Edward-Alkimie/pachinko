/**
 * useAuth: who is signed in, plus login / register / logout actions.
 *
 * Flow:  mount → status 'loading' → fetchMe()
 *          → 'authenticated' (session cookie still valid) or 'anonymous'
 *        login / register → isSubmitting = true → 'authenticated' on success,
 *          or stay 'anonymous' with `error` (+ per-field `fieldErrors`)
 *        logout → 'anonymous'
 *
 * The game does not need a sign-in yet; this only drives AuthPanel.
 */
import { useCallback, useEffect, useState } from 'react'
import * as auth from '../services/auth'
import type { FieldErrors, User } from '../services/auth'

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated'

export interface AuthState {
  readonly status: AuthStatus
  readonly user: User | null
  /** True while a login / register / logout request is in flight. */
  readonly isSubmitting: boolean
  /** Message to show the player, or null. */
  readonly error: string | null
  /** Backend validation messages per form field (e.g. username taken). */
  readonly fieldErrors: FieldErrors
}

export interface AuthActions {
  readonly login: (username: string, password: string) => Promise<void>
  readonly register: (username: string, password: string) => Promise<void>
  readonly logout: () => Promise<void>
  /** Clears `error` and `fieldErrors`, e.g. when switching form mode. */
  readonly clearError: () => void
}

const INITIAL_STATE: AuthState = {
  status: 'loading',
  user: null,
  isSubmitting: false,
  error: null,
  fieldErrors: {},
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'

/** Signed-in state for `user` (or signed-out when null), with errors cleared. */
function settled(user: User | null): AuthState {
  return { ...INITIAL_STATE, status: user ? 'authenticated' : 'anonymous', user }
}

export function useAuth(): { state: AuthState } & AuthActions {
  const [state, setState] = useState<AuthState>(INITIAL_STATE)

  // On load: ask the backend whether the session cookie is still signed in.
  useEffect(() => {
    let isCurrent = true // ignore the reply if the component unmounted
    auth
      .fetchMe()
      .then((user) => {
        if (isCurrent) setState(settled(user))
      })
      .catch((error: unknown) => {
        if (isCurrent) setState({ ...settled(null), error: messageOf(error) })
      })
    return () => {
      isCurrent = false
    }
  }, [])

  /**
   * Runs one auth request: marks the form busy, then stores the resulting
   * user, or keeps the current user and shows the error.
   */
  const submit = useCallback(async (call: () => Promise<User | null>) => {
    setState((s) => ({ ...s, isSubmitting: true, error: null, fieldErrors: {} }))
    try {
      const user = await call()
      setState(settled(user))
    } catch (error: unknown) {
      setState((s) => ({
        ...s,
        isSubmitting: false,
        error: messageOf(error),
        fieldErrors: error instanceof auth.ApiError ? error.fieldErrors : {},
      }))
    }
  }, [])

  const login = useCallback(
    (username: string, password: string) => submit(() => auth.login(username, password)),
    [submit],
  )
  const register = useCallback(
    (username: string, password: string) => submit(() => auth.register(username, password)),
    [submit],
  )
  const logout = useCallback(() => submit(async () => (await auth.logout(), null)), [submit])
  const clearError = useCallback(() => setState((s) => ({ ...s, error: null, fieldErrors: {} })), [])

  return { state, login, register, logout, clearError }
}

/** ApiError messages are written for players; anything else gets a generic one. */
function messageOf(error: unknown): string {
  return error instanceof auth.ApiError ? error.message : GENERIC_ERROR
}
