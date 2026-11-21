// @vitest-environment jsdom
/**
 * Page-level test: replay a seed from the Verify view, let the (fast-forwarded) round play out,
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
    expect(screen.getByText('Play on-chain, or verify a round, to see it on the board.')).toBeTruthy()
    expect(calls.arc).toBeGreaterThan(200) // 203 pins
  })

  it('shows the sign-in form once the session check says signed out', async () => {
    stubCanvas()
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeTruthy()
  })

  it('replays the SPEC golden seed to the golden hash (Verify view, Replay form)', async () => {
    stubCanvas()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    const seed = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
    fireEvent.change(screen.getByLabelText('Seed'), { target: { value: seed } })
    fireEvent.change(screen.getByLabelText('Round'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replay seed' }))
    await waitFor(() => expect(screen.getByText('All balls are down.')).toBeTruthy(), {
      timeout: 30_000,
    })
    expect(document.querySelector('.landed')?.textContent).toBe('Landed 100 / 100')
    const values = document.querySelectorAll('.round-info .value')
    expect(values[0].getAttribute('title')).toBe(seed)
    // docs/SPEC.md §3 golden fixture
    expect(values[1].getAttribute('title')).toBe('06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151')
  }, 60_000)
})
