import { useState, type FormEvent } from 'react'
import type { AuthActions, AuthState } from '../hooks/useAuth'

interface Props extends AuthActions {
  readonly state: AuthState
}

type Mode = 'login' | 'register'

/** Labels that change with the form mode. */
const COPY: Record<Mode, { submit: string; toggle: string; passwordAutocomplete: string }> = {
  login: { submit: 'Log in', toggle: 'Need an account? Register', passwordAutocomplete: 'current-password' },
  register: { submit: 'Create account', toggle: 'Have an account? Log in', passwordAutocomplete: 'new-password' },
}

/**
 * Sign-in box. Presentational: the auth state and actions come from
 * useAuth via props, so App owns the state and tests can pass fakes.
 *
 * Signed out → login / register form (one form, two modes).
 * Signed in  → "Signed in as <name>" and a Log out button.
 */
export function AuthPanel({ state, login, register, logout, clearError }: Props) {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)

  if (state.status === 'loading') {
    return <section className="auth-panel">Checking sign-in…</section>
  }

  if (state.status === 'authenticated' && state.user) {
    return (
      <section className="auth-panel signed-in">
        <span>
          Signed in as <strong>{state.user.username}</strong>
        </span>
        <button type="button" onClick={() => void logout()} disabled={state.isSubmitting}>
          Log out
        </button>
      </section>
    )
  }

  const copy = COPY[mode]

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Usernames never have outer spaces; passwords are sent exactly as typed.
    const name = username.trim()
    if (!name || !password) {
      setLocalError('Enter a username and password.')
      return
    }
    setLocalError(null)
    void (mode === 'login' ? login(name, password) : register(name, password))
  }

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setLocalError(null)
    clearError() // old backend errors belong to the other mode
  }

  // Field messages are shown under their inputs; the general one at the bottom.
  const usernameErrors = state.fieldErrors.username ?? []
  const passwordErrors = state.fieldErrors.password ?? []
  const generalError = localError ?? state.error

  return (
    <form className="auth-panel" onSubmit={submit} aria-label={copy.submit}>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          spellCheck={false}
          maxLength={150}
        />
      </label>
      {usernameErrors.map((m) => (
        <p key={m} className="field-error">
          {m}
        </p>
      ))}
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={copy.passwordAutocomplete}
          maxLength={128}
        />
      </label>
      {passwordErrors.map((m) => (
        <p key={m} className="field-error">
          {m}
        </p>
      ))}
      <button type="submit" disabled={state.isSubmitting}>
        {copy.submit}
      </button>
      <button type="button" className="link" onClick={switchMode} disabled={state.isSubmitting}>
        {copy.toggle}
      </button>
      {generalError && (
        <p className="error" role="alert">
          {generalError}
        </p>
      )}
    </form>
  )
}
