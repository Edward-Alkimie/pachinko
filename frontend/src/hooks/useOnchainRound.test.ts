// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as chain from '@pachinko/chain'
import { RoundCreated, RoundStatus, eventType, type Deployment, type RoundView } from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import type { AppDAppKit } from '../onchain/dappKit'
import {
  BET_MIST,
  canRefund,
  committeeVotes,
  phaseFor,
  replayCheck,
  settledCheck,
  stageOf,
  useOnchainRound,
} from './useOnchainRound'

vi.mock('@pachinko/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pachinko/chain')>()),
  fetchRound: vi.fn(),
  fetchSubmission: vi.fn(),
  fetchDispute: vi.fn(),
  findFinalized: vi.fn(),
  findResolved: vi.fn(),
  findCommitteeVotes: vi.fn(),
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
    verifierStakeMist: '20',
    voteWindowMs: '60000',
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

function view(status: RoundStatus, submitDeadlineMs = 0): RoundView {
  return {
    objectId: ROUND,
    roundId: 5n,
    player: '0x2',
    configVersion: DEFAULT_CONFIG.version,
    seed: status === RoundStatus.BetLocked ? null : SEED,
    betMist: BET_MIST,
    status,
    submitDeadlineMs,
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
      .mockResolvedValue({ Transaction: { digest: 'ACTION', status: { success: true } } }),
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
    vi.mocked(chain.findResolved).mockResolvedValue({
      operator_honest: false,
      winner: PLAYER,
      award: '15',
      by_committee: true,
    } as Awaited<ReturnType<typeof chain.findResolved>>)
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
    expect(result.current.state.challengeDigest).toBe('ACTION')

    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(result.current.state).toMatchObject({
      phase: 'final',
      payoutMist: 10_000_000n,
      resolution: { operatorHonest: false, winner: PLAYER, awardMist: 15n, byCommittee: true },
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
      walletAction: null,
      challengeDigest: null,
      actionError: 'User rejected',
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

  it('shows the committee and its votes while the round is challenged', async () => {
    vi.mocked(chain.fetchRound).mockResolvedValue(view(RoundStatus.Challenged))
    vi.mocked(chain.fetchDispute).mockResolvedValue({
      deadlineMs: 90_000,
      committee: ['0xa', '0xb', '0xc'],
      votes: [{ voter: '0xa', resultHash: Buffer.from(HONEST_HASH, 'hex') }],
    })

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, fakeDAppKit(), async () => HONEST_HASH))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(2_000)
    })

    const { dispute, replayHash } = result.current.state
    expect(dispute?.deadlineMs).toBe(90_000)
    expect(committeeVotes(dispute!, replayHash).map((c) => c.vote)).toEqual(['agrees', 'waiting', 'waiting'])
  })

  it('keeps the committee on screen once the round is final, with the deciding vote', async () => {
    const statuses = [RoundStatus.Challenged, RoundStatus.Finalized]
    vi.mocked(chain.fetchRound).mockImplementation(async () => view(statuses.shift() ?? RoundStatus.Finalized))
    const honest = new Uint8Array(Buffer.from(HONEST_HASH, 'hex'))
    vi.mocked(chain.fetchDispute).mockResolvedValue({
      deadlineMs: 90_000,
      committee: ['0xa', '0xb', '0xc'],
      votes: [{ voter: '0xa', resultHash: honest }],
    })
    vi.mocked(chain.findFinalized).mockResolvedValue({ payout: '0' } as Awaited<ReturnType<typeof chain.findFinalized>>)
    vi.mocked(chain.findResolved).mockResolvedValue({
      operator_honest: true,
      winner: '0x3',
      award: '10',
      by_committee: true,
    } as Awaited<ReturnType<typeof chain.findResolved>>)
    // The Dispute object is gone after the deciding vote; the events still hold every vote.
    vi.mocked(chain.findCommitteeVotes).mockResolvedValue({
      deadlineMs: 90_000,
      committee: ['0xa', '0xb', '0xc'],
      votes: [
        { voter: '0xa', resultHash: honest },
        { voter: '0xb', resultHash: honest },
      ],
    })

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, fakeDAppKit(), async () => HONEST_HASH))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(5_000)
    })

    const { phase, dispute, replayHash } = result.current.state
    expect(phase).toBe('final')
    expect(committeeVotes(dispute!, replayHash).map((c) => c.vote)).toEqual(['agrees', 'agrees', 'waiting'])
  })

  it('lets the player refund the bet when the operator misses the submit deadline', async () => {
    const deadline = Date.now() + 1_000
    vi.mocked(chain.fetchRound).mockResolvedValue(view(RoundStatus.Seeded, deadline))
    const dAppKit = fakeDAppKit()

    const { result } = renderHook(() => useOnchainRound(DEPLOYMENT, dAppKit, async () => HONEST_HASH))
    await act(async () => {
      void result.current.play()
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(result.current.state).toMatchObject({ phase: 'waitingResult', submitDeadlineMs: deadline })
    expect(canRefund(result.current.state, Date.now())).toBe(true)

    vi.mocked(chain.fetchRound).mockResolvedValue(view(RoundStatus.Refunded, deadline))
    await act(() => result.current.refund())
    expect(dAppKit.signAndExecuteTransaction).toHaveBeenCalledTimes(2)
    expect(result.current.state.refundDigest).toBe('ACTION')

    await act(() => vi.advanceTimersByTimeAsync(2_000))
    expect(result.current.state.phase).toBe('refunded')
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

describe('canRefund', () => {
  const seeded = { phase: 'waitingResult' as const, submitDeadlineMs: 1_000, refundDigest: null }
  it('only once seeded, past the submit deadline, and not refunded yet', () => {
    expect(canRefund(seeded, 999)).toBe(false)
    expect(canRefund(seeded, 1_000)).toBe(true)
    expect(canRefund({ ...seeded, refundDigest: 'TX' }, 1_000)).toBe(false)
    expect(canRefund({ ...seeded, phase: 'verifying' }, 1_000)).toBe(false)
    expect(canRefund({ ...seeded, submitDeadlineMs: 0 }, 1_000)).toBe(false)
  })
})

describe('committeeVotes', () => {
  it('compares each drawn verifier vote with the page replay', () => {
    const dispute = {
      deadlineMs: 0,
      committee: ['0xa', '0xb', '0xc'],
      votes: [
        { voter: '0xa', resultHash: HONEST_HASH },
        { voter: '0xc', resultHash: FORGED_HASH },
      ],
    }
    expect(committeeVotes(dispute, HONEST_HASH)).toEqual([
      { verifier: '0xa', vote: 'agrees' },
      { verifier: '0xb', vote: 'waiting' },
      { verifier: '0xc', vote: 'disagrees' },
    ])
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
    expect(phaseFor(RoundStatus.Refunded)).toBe('refunded')
  })
})

describe('settledCheck', () => {
  const verdict = (operatorHonest: boolean) => ({ operatorHonest, winner: '0x3', awardMist: 10n, byCommittee: true })

  it('once final after a challenge, the verdict answers the check', () => {
    expect(settledCheck('mismatch', true, verdict(false))).toBe('overturned')
    expect(settledCheck('match', true, verdict(true))).toBe('upheld')
  })

  it('once final with no challenge, says what paid out', () => {
    expect(settledCheck('mismatch', true, null)).toBe('unchallenged')
    expect(settledCheck('match', true, null)).toBe('paid')
    expect(settledCheck('unavailable', true, null)).toBe('unavailable')
  })

  it('keeps the plain check before the round is final, or when a verdict contradicts the replay', () => {
    expect(settledCheck('mismatch', false, null)).toBe('mismatch')
    expect(settledCheck('match', false, null)).toBe('match')
    expect(settledCheck('mismatch', true, verdict(true))).toBe('mismatch')
    expect(settledCheck('unavailable', true, verdict(false))).toBe('unavailable')
  })
})
