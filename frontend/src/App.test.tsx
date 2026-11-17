// @vitest-environment jsdom
/**
 * Page-level test: click Start, let the (fast-forwarded) round play out,
 * and check the board is drawn and the results appear.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

/** jsdom has no canvas; count draw calls on a stand-in context instead. */
function stubCanvas() {
  const calls = { arc: 0 }
  const noop = () => {}
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, prop) => (prop === 'arc' ? () => calls.arc++ : noop),
    set: () => true,
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    ctx as unknown as CanvasRenderingContext2D,
  )
  return calls
}

beforeEach(() => {
  // No backend in tests: every API call answers "not signed in" (403).
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ detail: 'Not signed in.' }) })),
  )
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb((now += 1000)), 0) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('draws the board on load', () => {
    const calls = stubCanvas()
    render(<App />)
    expect(screen.getByText('Press Start to play a round.')).toBeTruthy()
    expect(calls.arc).toBeGreaterThan(200) // 203 pins
  })

  it('shows the sign-in form once the session check says signed out', async () => {
    stubCanvas()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
  })

  it('plays a full round after Start and shows the seed and hash', async () => {
    stubCanvas()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(screen.getByText('Round finished.')).toBeTruthy(), {
      timeout: 30_000,
    })
    expect(document.querySelector('.landed')?.textContent).toBe('Landed 100 / 100')
    const mono = document.querySelectorAll('.round-info .mono')
    expect(mono[0].textContent).toMatch(/^[0-9a-f]{64}$/) // seed
    expect(mono[1].textContent).toMatch(/^[0-9a-f]{64}$/) // hash
  }, 60_000)
})
