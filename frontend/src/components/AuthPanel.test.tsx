// @vitest-environment jsdom
/**
 * AuthPanel is presentational: it gets the auth state + actions as props,
 * so these tests pass fakes and check what is shown and what gets called.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthState } from '../hooks/useAuth'
import { AuthPanel } from './AuthPanel'

afterEach(cleanup)

const ANONYMOUS: AuthState = {
  status: 'anonymous',
  user: null,
  isSubmitting: false,
  error: null,
  fieldErrors: {},
}

function renderPanel(state: Partial<AuthState> = {}) {
  const actions = {
    login: vi.fn().mockResolvedValue(undefined),
    register: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
  }
  render(<AuthPanel state={{ ...ANONYMOUS, ...state }} {...actions} />)
  return actions
}

const fill = (username: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: username } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } })
}

describe('AuthPanel', () => {
  it('shows a loading line while the session is checked', () => {
    renderPanel({ status: 'loading' })
    expect(screen.getByText('Checking sign-in…')).toBeTruthy()
  })

  it('logs in with the typed username and password', () => {
    const { login } = renderPanel()
    fill(' kevin ', 'pw')
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(login).toHaveBeenCalledWith('kevin', 'pw') // username trimmed, password not
  })

  it('switches to registration mode', () => {
    const { register, clearError } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Need an account? Register' }))
    expect(clearError).toHaveBeenCalled()
    expect((screen.getByLabelText('Password') as HTMLInputElement).autocomplete).toBe('new-password')

    fill('kiana', 'pw')
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(register).toHaveBeenCalledWith('kiana', 'pw')
  })

  it('does not submit empty fields', () => {
    const { login } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }))
    expect(login).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toMatch(/Enter a username and password/)
  })

  it('shows backend field errors next to the fields', () => {
    renderPanel({ error: 'Taken.', fieldErrors: { username: ['Taken.'], password: ['Too short.'] } })
    expect(screen.getByText('Too short.')).toBeTruthy()
    expect(screen.getAllByText('Taken.').length).toBeGreaterThan(0)
  })

  it('disables the form while submitting', () => {
    renderPanel({ isSubmitting: true })
    expect((screen.getByRole('button', { name: 'Log in' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the signed-in user and logs out', () => {
    const { logout } = renderPanel({ status: 'authenticated', user: { id: 1, username: 'kevin' } })
    expect(screen.getByText('kevin')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(logout).toHaveBeenCalled()
  })
})
