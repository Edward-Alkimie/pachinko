// @vitest-environment jsdom
/**
 * Tests the real hook end to end (real physics, real React state), with the
 * animation clock faked so a 12-second round plays back instantly.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { useRound } from './useRound'

const GOLDEN_SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const GOLDEN_HASH = '06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151'
/** Each fake animation frame jumps 1 s ahead (= 120 ticks). */
const FAKE_FRAME_MS = 1000

beforeEach(() => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb((now += FAKE_FRAME_MS)), 0) as unknown as number,
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('useRound', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useRound(DEFAULT_CONFIG))
    expect(result.current.state.status).toBe('idle')
  })

  it('simulates, plays back to the end, and reports the golden hash', async () => {
    const { result } = renderHook(() => useRound(DEFAULT_CONFIG))
    const seen = new Set<string>()

    act(() => void result.current.start(GOLDEN_SEED, 1n))
    seen.add(result.current.state.status)

    await waitFor(
      () => {
        seen.add(result.current.state.status)
        expect(result.current.state.status).toBe('done')
      },
      { timeout: 30_000, interval: 5 },
    )

    const { state } = result.current
    expect(seen.has('simulating')).toBe(true)
    expect(state.result?.resultHash).toBe(GOLDEN_HASH)
    expect(state.tick).toBe(state.result?.endTick)
    expect(state.seedHex).toBe(GOLDEN_SEED)
    expect(state.roundId).toBe(1n)
  }, 60_000)

  it('shows an error instead of crashing on a bad seed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useRound(DEFAULT_CONFIG))
    act(() => void result.current.start('not-a-seed', 1n))
    await waitFor(() => expect(result.current.state.status).toBe('error'))
    expect(result.current.state.error).toMatch(/Simulation failed: seed must be/)
  })
})
