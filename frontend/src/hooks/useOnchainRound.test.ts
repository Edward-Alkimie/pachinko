// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as chain from '@pachinko/chain'
import { RoundCreated, RoundStatus, eventType, type Deployment, type RoundView } from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import type { AppDAppKit } from '../onchain/dappKit'
import { BET_MIST, phaseFor, replayCheck, stageOf, useOnchainRound } from './useOnchainRound'

vi.mock('@pachinko/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pachinko/chain')>()),
  fetchRound: vi.fn(),
  fetchSubmission: vi.fn(),
  findFinalized: vi.fn(),
  findResolved: vi.fn(),
}))

const id = (byte: string) => `0x${byte.repeat(32)}`
const DEPLOYMENT: Deployment = {
  network: 'testnet',
  packageId: id('01'),
  gameId: id('02'),
  houseId: id('03'),
  adminCapId: id('04'),
  operatorCapId: id('05'),
  house: {
    multipliersBps: ['10000'],
    ballsPerRound: '100',
    operatorBondMist: '10',
    challengerBondMist: '10',
    challengeWindowMs: '30000',
  },
}
const ROUND = id('ab')
const SEED = new Uint8Array(32).fill(7)
const HONEST_HASH = 'aa'.repeat(32)
const FORGED_HASH = 'ff'.repeat(32)
const PLAYER = id('02')

function submission(hashHex: string): chain.SubmissionView {
  return { deadlineMs: Date.now() + 30_000, resultHash: new Uint8Array(Buffer.from(hashHex, 'hex')) } as chain.SubmissionView
}

function view(status: RoundStatus): RoundView {
  return {
    objectId: ROUND,
    roundId: 5n,
    player: '0x2',
    configVersion: DEFAULT_CONFIG.version,
    seed: status === RoundStatus.BetLocked ? null : SEED,
    betMist: BET_MIST,
    status,
  }
}

/** A wallet that signs at once, and a client whose indexed tx carries the RoundCreated event. */
function fakeDAppKit(): AppDAppKit {
  const created = RoundCreated.serialize({
    round: ROUND,
    round_id: 5,
    player: '0x2',
    bet: BET_MIST,
    config_version: DEFAULT_CONFIG.version,
  }).toBytes()
  return {
    signAndExecuteTransaction: vi
      .fn()
      .mockResolvedValueOnce({ Transaction: { digest: 'BET', status: { success: true } } })
      .mockResolvedValue({ Transaction: { digest: 'CHALLENGE', status: { success: true } } }),
    getClient: () => ({
      core: {
        waitForTransaction: async () => ({
          Transaction: { events: [{ eventType: eventType(DEPLOYMENT.packageId, 'RoundCreated'), bcs: created }] },
        }),
      },
    }),
  } as unknown as AppDAppKit
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useOnchainRound', () => {
  it('bets, plays the on-chain seed once, and ends with the payout', async () => {
    const statuses = [RoundStatus.BetLocked, RoundStatus.Seeded, RoundStatus.Submitted, RoundStatus.Finalized]
    vi.mocked(chain.fetchRound).mockImplementation(async () => view(statuses.shift() ?? RoundStatus.Finalized))
    const sub = submission(HONEST_HASH)
    vi.mocked(chain.fetchSubmission).mockResolvedValue(sub)
    vi.mocked(chain.findFinalized).mockResolvedValue({ payout: '12000000' } as Awaited<
      ReturnType<typeof chain.findFinalized>
    >)
    vi.mocked(chain.findResolved).mockResolvedValue(null)
    const onSeed = vi.fn(async () => HONEST_HASH)

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, fakeDAppKit(), onSeed))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(onSeed).toHaveBeenCalledTimes(1)
    expect(onSeed).toHaveBeenCalledWith('07'.repeat(32), 5n)
    expect(result.current.state).toMatchObject({
      phase: 'final',
      roundObjectId: ROUND,
      roundId: 5n,
      createDigest: 'BET',
      deadlineMs: sub.deadlineMs,
      replay: 'done',
      replayHash: HONEST_HASH,
      submittedHash: HONEST_HASH,
      payoutMist: 12_000_000n,
      resolution: null,
    })
    expect(replayCheck(result.current.state)).toBe('match')
  })

  it('lets the player challenge a mismatched result and shows the verdict', async () => {
    const statuses = [RoundStatus.Seeded, RoundStatus.Submitted, RoundStatus.Submitted]
    vi.mocked(chain.fetchRound).mockImplementation(async () => view(statuses.shift() ?? RoundStatus.Finalized))
    vi.mocked(chain.fetchSubmission).mockResolvedValue(submission(FORGED_HASH))
    vi.mocked(chain.findFinalized).mockResolvedValue({ payout: '10000000' } as Awaited<
      ReturnType<typeof chain.findFinalized>
    >)
    vi.mocked(chain.findResolved).mockResolvedValue({ operator_honest: false, winner: PLAYER, award: '20' } as Awaited<
      ReturnType<typeof chain.findResolved>
    >)
    const dAppKit = fakeDAppKit()

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, dAppKit, async () => HONEST_HASH))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.state.phase).toBe('verifying')
    expect(replayCheck(result.current.state)).toBe('mismatch')

    await act(() => result.current.challenge())
    expect(dAppKit.signAndExecuteTransaction).toHaveBeenCalledTimes(2)
    expect(result.current.state.challengeDigest).toBe('CHALLENGE')

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(result.current.state).toMatchObject({
      phase: 'final',
      payoutMist: 10_000_000n,
      resolution: { operatorHonest: false, winner: PLAYER, awardMist: 20n },
    })
  })

  it('shows a failed challenge without leaving the round', async () => {
    vi.mocked(chain.fetchRound).mockResolvedValue(view(RoundStatus.Submitted))
    vi.mocked(chain.fetchSubmission).mockResolvedValue(submission(FORGED_HASH))
    const dAppKit = fakeDAppKit()
    vi.mocked(dAppKit.signAndExecuteTransaction)
      .mockReset()
      .mockResolvedValueOnce({ Transaction: { digest: 'BET', status: { success: true } } } as never)
      .mockRejectedValueOnce(new Error('User rejected'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, dAppKit, async () => HONEST_HASH))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(2_000)
    })
    await act(() => result.current.challenge())

    expect(result.current.state).toMatchObject({
      phase: 'verifying',
      challenging: false,
      challengeDigest: null,
      challengeError: 'User rejected',
    })
  })

  it('holds the chain result back until the board has finished playing', async () => {
    vi.mocked(chain.fetchRound).mockResolvedValue(view(RoundStatus.Submitted))
    vi.mocked(chain.fetchSubmission).mockResolvedValue(submission(FORGED_HASH))
    let finishPlayback: (hash: string) => void = () => {}
    const onSeed = () => new Promise<string | null>((resolve) => (finishPlayback = resolve))

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, fakeDAppKit(), onSeed))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(2_000)
    })
    // The chain is already at SUBMITTED, but the balls are still falling.
    expect(result.current.state.phase).toBe('verifying')
    expect(stageOf(result.current.state)).toBe('playing')
    expect(replayCheck(result.current.state)).toBeNull()

    await act(async () => finishPlayback(HONEST_HASH))
    expect(stageOf(result.current.state)).toBe('verifying')
    expect(replayCheck(result.current.state)).toBe('mismatch')
  })

  it('marks an interrupted replay and can play the round again', async () => {
    vi.mocked(chain.fetchRound).mockResolvedValue(view(RoundStatus.Submitted))
    vi.mocked(chain.fetchSubmission).mockResolvedValue(submission(HONEST_HASH))
    const onSeed = vi.fn<(seedHex: string, roundId: bigint) => Promise<string | null>>()
    onSeed.mockResolvedValueOnce(null).mockResolvedValueOnce(HONEST_HASH)

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, fakeDAppKit(), onSeed))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.state.replay).toBe('interrupted')
    expect(replayCheck(result.current.state)).toBe('unavailable')

    await act(async () => result.current.replayAgain())
    expect(onSeed).toHaveBeenLastCalledWith('07'.repeat(32), 5n)
    expect(replayCheck(result.current.state)).toBe('match')
  })

  it('keeps following through a failed read and waits for the Finalized event to be indexed', async () => {
    vi.mocked(chain.fetchRound)
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(view(RoundStatus.Finalized))
    vi.mocked(chain.findFinalized)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ payout: '0' } as Awaited<ReturnType<typeof chain.findFinalized>>)
    vi.mocked(chain.findResolved).mockResolvedValue(null)
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, fakeDAppKit(), async () => HONEST_HASH))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(10_000)
    })

    expect(result.current.state).toMatchObject({ phase: 'final', payoutMist: 0n, error: null })
  })

  it('shows the error when the wallet rejects the bet', async () => {
    const dAppKit = fakeDAppKit()
    vi.mocked(dAppKit.signAndExecuteTransaction).mockReset().mockRejectedValue(new Error('User rejected'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, dAppKit, async () => null))
    await act(() => result.current.play())

    expect(result.current.state).toMatchObject({ phase: 'error', error: 'User rejected' })
  })
})

describe('replayCheck', () => {
  it('compares only once the result is submitted and the replay has played to the end', () => {
    expect(replayCheck({ replay: 'done', replayHash: HONEST_HASH, submittedHash: null })).toBeNull()
    expect(replayCheck({ replay: 'playing', replayHash: null, submittedHash: HONEST_HASH })).toBeNull()
    expect(replayCheck({ replay: 'done', replayHash: HONEST_HASH, submittedHash: HONEST_HASH })).toBe('match')
    expect(replayCheck({ replay: 'done', replayHash: HONEST_HASH, submittedHash: FORGED_HASH })).toBe('mismatch')
    expect(replayCheck({ replay: 'interrupted', replayHash: null, submittedHash: HONEST_HASH })).toBe('unavailable')
  })
})

describe('stageOf', () => {
  it('shows "playing" over any chain phase while the board animates, except an error', () => {
    expect(stageOf({ phase: 'verifying', replay: 'playing' })).toBe('playing')
    expect(stageOf({ phase: 'verifying', replay: 'done' })).toBe('verifying')
    expect(stageOf({ phase: 'error', replay: 'playing' })).toBe('error')
  })
})

describe('phaseFor', () => {
  it('maps every on-chain status to a page phase', () => {
    expect(phaseFor(RoundStatus.BetLocked)).toBe('waitingSeed')
    expect(phaseFor(RoundStatus.Seeded)).toBe('waitingResult')
    expect(phaseFor(RoundStatus.Submitted)).toBe('verifying')
    expect(phaseFor(RoundStatus.Challenged)).toBe('challenged')
    expect(phaseFor(RoundStatus.Finalized)).toBe('final')
  })
})
