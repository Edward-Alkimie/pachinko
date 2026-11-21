/**
 * useOnchainRound: plays one round on Sui testnet from the player's wallet.
 *
 *   play() → wallet signs create_round (bet locked)          phase 'signing' → 'waitingSeed'
 *          → operator draws the seed                          phase 'waitingResult'
 *            onSeed(seed, round_id) plays it on the board     replay 'playing' → 'done' (with its hash)
 *          → operator submits; challenge window runs           phase 'verifying'
 *            the page compares its replay hash with the submitted one (replayCheck);
 *            on a mismatch the player may challenge() with the bond (docs/CONTRACTS.md §1, step 1)
 *          → finalized (after the window, or by the arbiter); payout from Finalized,
 *            verdict from Resolved if the round was challenged   phase 'final'
 *
 * Two clocks run here: `phase` follows the chain, `replay` follows the board. The panel shows
 * `stageOf(state)`, which holds every chain result back while the balls are still falling, so
 * the page never reveals the result before the animation does.
 *
 * The page only reads the chain (polls the Round) and signs the bet and any challenge; the
 * operator and arbiter (physics-service) do the rest. Failed reads are retried on the next poll.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toHex } from '@mysten/sui/utils'
import {
  RoundCreated,
  RoundStatus,
  challengeTx,
  createRoundTx,
  eventType,
  fetchRound,
  fetchSubmission,
  findFinalized,
  findResolved,
  type Deployment,
} from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import type { AppDAppKit } from '../onchain/dappKit'

/** Bet per on-chain round: 0.01 SUI. */
export const BET_MIST = 10_000_000n
const POLL_MS = 1_500

/** Where the round is on-chain. */
export type OnchainPhase =
  | 'idle'
  | 'signing'
  | 'waitingSeed'
  | 'waitingResult'
  | 'verifying'
  | 'challenged'
  | 'final'
  | 'error'

/** The page's own replay of the seed: `interrupted` = the board was given another round meanwhile. */
export type ReplayStatus = 'none' | 'playing' | 'done' | 'interrupted'

/** What the panel shows: the chain phase, except `playing` while the board is still animating. */
export type OnchainStage = OnchainPhase | 'playing'

/** How a challenge was settled (the round's `Resolved` event). */
export interface Resolution {
  readonly operatorHonest: boolean
  /** Who received both bonds. */
  readonly winner: string
  readonly awardMist: bigint
}

export interface OnchainState {
  readonly phase: OnchainPhase
  readonly roundObjectId: string | null
  readonly roundId: bigint | null
  readonly createDigest: string | null
  /** The round's seed (hex), once drawn. */
  readonly seedHex: string | null
  readonly replay: ReplayStatus
  /** Hash of the page's own replay, once it has played to the end. */
  readonly replayHash: string | null
  /** End of the challenge window (chain ms), once the result is submitted. */
  readonly deadlineMs: number | null
  /** Hash the operator submitted. */
  readonly submittedHash: string | null
  /** The wallet is signing a challenge. */
  readonly challenging: boolean
  readonly challengeDigest: string | null
  readonly challengeError: string | null
  readonly payoutMist: bigint | null
  /** Set when the round was challenged and settled. */
  readonly resolution: Resolution | null
  readonly error: string | null
}

const INITIAL: OnchainState = {
  phase: 'idle',
  roundObjectId: null,
  roundId: null,
  createDigest: null,
  seedHex: null,
  replay: 'none',
  replayHash: null,
  deadlineMs: null,
  submittedHash: null,
  challenging: false,
  challengeDigest: null,
  challengeError: null,
  payoutMist: null,
  resolution: null,
  error: null,
}

/** Page phase for an on-chain round status. */
export function phaseFor(status: RoundStatus): OnchainPhase {
  switch (status) {
    case RoundStatus.BetLocked:
      return 'waitingSeed'
    case RoundStatus.Seeded:
      return 'waitingResult'
    case RoundStatus.Submitted:
      return 'verifying'
    case RoundStatus.Challenged:
      return 'challenged'
    case RoundStatus.Finalized:
      return 'final'
  }
}

/** What the panel shows: chain progress is held back while the board is still playing the round. */
export function stageOf(state: Pick<OnchainState, 'phase' | 'replay'>): OnchainStage {
  if (state.phase === 'error') return 'error'
  return state.replay === 'playing' ? 'playing' : state.phase
}

/**
 * Page replay vs submitted result, once both exist: `null` before that (or while the board plays),
 * `unavailable` if the replay was interrupted (replay the round again to check it).
 */
export type ReplayCheck = 'match' | 'mismatch' | 'unavailable' | null

export function replayCheck(
  state: Pick<OnchainState, 'replay' | 'replayHash' | 'submittedHash'>,
): ReplayCheck {
  if (state.submittedHash === null) return null
  if (state.replay === 'interrupted') return 'unavailable'
  if (state.replay !== 'done' || state.replayHash === null) return null
  return state.replayHash === state.submittedHash ? 'match' : 'mismatch'
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function useOnchainRound(
  deployment: Deployment,
  dAppKit: AppDAppKit,
  /** Plays the seed on the board; resolves with the replay's hash once playback ends (null if cut short). */
  onSeed: (seedHex: string, roundId: bigint) => Promise<string | null>,
) {
  const [state, setState] = useState<OnchainState>(INITIAL)
  // Incremented by every play() and on unmount: an older follow loop sees a new number and stops.
  const runId = useRef(0)
  useEffect(() => () => void runId.current++, [])

  /** Plays the round's seed on the board and records how the replay ended. */
  const playSeed = useCallback(
    (seedHex: string, roundId: bigint, myRun: number) => {
      setState((s) => ({ ...s, seedHex, replay: 'playing', replayHash: null }))
      void onSeed(seedHex, roundId).then((replayHash) => {
        if (myRun !== runId.current) return
        setState((s) => ({ ...s, replay: replayHash ? 'done' : 'interrupted', replayHash }))
      })
    },
    [onSeed],
  )

  /** Reads the round once and moves the page forward. Returns true when the round is settled. */
  const poll = useCallback(
    async (objectId: string, myRun: number, seedPlayed: boolean): Promise<{ settled: boolean; seedPlayed: boolean }> => {
      const client = dAppKit.getClient()
      const round = await fetchRound(client, objectId)
      if (myRun !== runId.current) return { settled: true, seedPlayed }

      if (round.seed && !seedPlayed) {
        if (round.configVersion !== DEFAULT_CONFIG.version) {
          throw new FatalError(`round uses physics ${round.configVersion}, this page runs ${DEFAULT_CONFIG.version}`)
        }
        playSeed(toHex(round.seed), round.roundId, myRun)
        seedPlayed = true
      }

      const phase = phaseFor(round.status)
      if (phase === 'verifying') {
        const submission = await fetchSubmission(client, deployment, objectId)
        const submittedHash = toHex(submission.resultHash)
        setState((s) => ({ ...s, phase, deadlineMs: submission.deadlineMs, submittedHash }))
        return { settled: false, seedPlayed }
      }
      if (phase === 'final') {
        // A challenge can be settled between two polls, so always look for a verdict.
        const [finalized, resolved] = await Promise.all([
          findFinalized(client, deployment.packageId, objectId),
          findResolved(client, deployment.packageId, objectId),
        ])
        // The status can be read a moment before the event is indexed: try again next poll.
        if (!finalized) return { settled: false, seedPlayed }
        const resolution = resolved
          ? { operatorHonest: resolved.operator_honest, winner: resolved.winner, awardMist: BigInt(resolved.award) }
          : null
        setState((s) => ({ ...s, phase, payoutMist: BigInt(finalized.payout), resolution }))
        return { settled: true, seedPlayed }
      }
      setState((s) => ({ ...s, phase }))
      return { settled: false, seedPlayed }
    },
    [dAppKit, deployment, playSeed],
  )

  /** Polls the round until it is settled. A failed read (e.g. a network blip) is retried. */
  const follow = useCallback(
    async (objectId: string, myRun: number) => {
      let seedPlayed = false
      for (;;) {
        try {
          const step = await poll(objectId, myRun, seedPlayed)
          if (step.settled) return
          seedPlayed = step.seedPlayed
        } catch (err) {
          if (err instanceof FatalError) throw err
          console.warn('useOnchainRound: read failed, retrying', err)
        }
        if (myRun !== runId.current) return
        await sleep(POLL_MS)
      }
    },
    [poll],
  )

  const play = useCallback(async () => {
    const myRun = ++runId.current
    setState({ ...INITIAL, phase: 'signing' })
    try {
      const result = await dAppKit.signAndExecuteTransaction({ transaction: createRoundTx(deployment, BET_MIST) })
      const tx = result.Transaction ?? result.FailedTransaction
      if (!tx.status.success) throw new Error(`bet failed: ${JSON.stringify(tx.status.error)}`)

      // The wallet result has no events; read them once the transaction is indexed.
      const indexed = await dAppKit.getClient().core.waitForTransaction({ digest: tx.digest, include: { events: true } })
      const event = indexed.Transaction?.events.find(
        (e) => e.eventType === eventType(deployment.packageId, 'RoundCreated'),
      )
      if (!event) throw new Error(`no RoundCreated event in ${tx.digest}`)
      const created = RoundCreated.parse(event.bcs)
      if (myRun !== runId.current) return

      setState((s) => ({
        ...s,
        phase: 'waitingSeed',
        roundObjectId: created.round,
        roundId: BigInt(created.round_id),
        createDigest: tx.digest,
      }))
      await follow(created.round, myRun)
    } catch (err) {
      if (myRun !== runId.current) return
      console.error('useOnchainRound:', err)
      setState((s) => ({ ...s, phase: 'error', error: err instanceof Error ? err.message : String(err) }))
    }
  }, [dAppKit, deployment, follow])

  /** Plays this round's seed again, e.g. after the board was given another seed mid-round. */
  const replayAgain = useCallback(() => {
    if (state.seedHex === null || state.roundId === null) return
    playSeed(state.seedHex, state.roundId, runId.current)
  }, [playSeed, state.seedHex, state.roundId])

  /** Disputes the submitted result with the challenger bond (the player decides; only inside the window). */
  const challenge = useCallback(async () => {
    const objectId = state.roundObjectId
    if (!objectId) return
    setState((s) => ({ ...s, challenging: true, challengeError: null }))
    try {
      const result = await dAppKit.signAndExecuteTransaction({ transaction: challengeTx(deployment, objectId) })
      const tx = result.Transaction ?? result.FailedTransaction
      if (!tx.status.success) throw new Error(`challenge failed: ${JSON.stringify(tx.status.error)}`)
      setState((s) => ({ ...s, challenging: false, challengeDigest: tx.digest }))
    } catch (err) {
      console.error('useOnchainRound: challenge', err)
      const challengeError = err instanceof Error ? err.message : String(err)
      setState((s) => ({ ...s, challenging: false, challengeError }))
    }
  }, [dAppKit, deployment, state.roundObjectId])

  return { state, play, challenge, replayAgain }
}

/** An error that retrying won't fix (e.g. the round needs another physics version). */
class FatalError extends Error {}
