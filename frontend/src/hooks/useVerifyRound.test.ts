// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { describe, expect, it, vi } from 'vitest'
import * as chain from '@pachinko/chain'
import { RoundStatus, type Deployment, type RoundHistory, type RoundView } from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { useVerifyRound } from './useVerifyRound'

vi.mock('@pachinko/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pachinko/chain')>()),
  findRoundByNumber: vi.fn(),
  fetchRound: vi.fn(),
  fetchRoundHistory: vi.fn(),
}))

// docs/SPEC.md §3 golden fixture: seed 000102…1f, round 1.
const GOLDEN_SEED = Uint8Array.from({ length: 32 }, (_, i) => i)
const GOLDEN_HASH = '06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151'
const DEPLOYMENT = { packageId: `0x${'01'.repeat(32)}` } as Deployment
const CLIENT = {} as ClientWithCoreApi
const HISTORY = { votes: [] } as unknown as RoundHistory

function round(seed: Uint8Array | null, configVersion = DEFAULT_CONFIG.version): RoundView {
  return {
    objectId: '0xab',
    roundId: 1n,
    player: '0x2',
    configVersion,
    seed,
    betMist: 0n,
    status: RoundStatus.Finalized,
    submitDeadlineMs: 0,
  }
}

function setUp(view: RoundView | null) {
  vi.mocked(chain.findRoundByNumber).mockResolvedValue(
    view ? ({ round: '0xab', bet: '10000000' } as Awaited<ReturnType<typeof chain.findRoundByNumber>>) : null,
  )
  if (view) vi.mocked(chain.fetchRound).mockResolvedValue(view)
  vi.mocked(chain.fetchRoundHistory).mockResolvedValue(HISTORY)
}

describe('useVerifyRound', () => {
  it('reads the round without replaying it, then checks it with the board replay', async () => {
    setUp(round(GOLDEN_SEED))
    const playOnBoard = vi.fn(async () => GOLDEN_HASH)
    const { result } = renderHook(() => useVerifyRound(DEPLOYMENT, CLIENT, playOnBoard))
    await act(() => result.current.verify(1n))
    expect(result.current.state).toMatchObject({
      status: 'done',
      roundId: 1n,
      replay: 'none',
      result: { betMist: 10_000_000n, canReplay: true, replayHash: null, history: HISTORY },
    })
    expect(playOnBoard).not.toHaveBeenCalled()

    await act(() => result.current.replayOnBoard())
    expect(playOnBoard).toHaveBeenCalledWith('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 1n)
    expect(result.current.state).toMatchObject({ status: 'done', replay: 'done', result: { replayHash: GOLDEN_HASH } })
    expect(result.current.ownReplayPlaying).toBe(false)
  })

  it('marks a replay cut short as interrupted, with no hash', async () => {
    setUp(round(GOLDEN_SEED))
    const { result } = renderHook(() => useVerifyRound(DEPLOYMENT, CLIENT, async () => null))
    await act(() => result.current.verify(1n))
    await act(() => result.current.replayOnBoard())
    expect(result.current.state).toMatchObject({ status: 'done', replay: 'interrupted', result: { replayHash: null } })
  })

  it('does not replay a round of another physics version', async () => {
    setUp(round(GOLDEN_SEED, 'pachinko-v9'))
    const playOnBoard = vi.fn(async () => GOLDEN_HASH)
    const { result } = renderHook(() => useVerifyRound(DEPLOYMENT, CLIENT, playOnBoard))
    await act(() => result.current.verify(1n))
    await act(() => result.current.replayOnBoard())
    expect(playOnBoard).not.toHaveBeenCalled()
    expect(result.current.state).toMatchObject({ status: 'done', result: { canReplay: false, replayHash: null } })
  })

  it('reports a round number that does not exist', async () => {
    setUp(null)
    const { result } = renderHook(() => useVerifyRound(DEPLOYMENT, CLIENT, async () => null))
    await act(() => result.current.verify(99n))
    expect(result.current.state).toEqual({ status: 'error', roundId: 99n, error: 'No round #99 on this deployment.' })
  })
})
