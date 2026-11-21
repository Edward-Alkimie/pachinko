/**
 * useOnchainRound: plays one round on Sui testnet from the player's wallet.
 *
 *   play() → wallet signs create_round (bet locked)          phase 'signing'
 *          → operator draws the seed                          phase 'waitingSeed'
 *          → seed appears: onSeed(seed, round_id) plays it    (the existing useRound animation;
 *                                                               it resolves with the page's replay hash)
 *          → operator submits; challenge window runs           phase 'verifying'
 *            the page compares its replay hash with the submitted one (replayCheck);
 *            on a mismatch the player may challenge() with the bond (docs/CONTRACTS.md §1, step 1)
 *          → finalized (after the window, or by the arbiter); payout from Finalized,
 *            verdict from Resolved if the round was challenged   phase 'final'
 *
 * The page only reads the chain (polls the Round) and signs the bet and any challenge; the
 * operator and arbiter (physics-service) do the rest.
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
  type RoundView,
} from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import type { AppDAppKit } from '../onchain/dappKit'

/** Bet per on-chain round: 0.01 SUI. */
export const BET_MIST = 10_000_000n
const POLL_MS = 1_500

export type OnchainPhase = 'idle' | 'signing' | 'waitingSeed' | 'verifying' | 'challenged' | 'final' | 'error'

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
  /** End of the challenge window (chain ms), once the result is submitted. */
  readonly deadlineMs: number | null
  /** Hash of the page's own replay of the on-chain seed. */
  readonly replayHash: string | null
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
  deadlineMs: null,
  replayHash: null,
  submittedHash: null,
  challenging: false,
  challengeDigest: null,
  challengeError: null,
  payoutMist: null,
  resolution: null,
  error: null,
}

/** Page replay vs submitted result: `null` until submitted, `pending` while the replay runs. */
export type ReplayCheck = 'pending' | 'match' | 'mismatch' | null

export function replayCheck(state: Pick<OnchainState, 'replayHash' | 'submittedHash'>): ReplayCheck {
  if (state.submittedHash === null) return null
  if (state.replayHash === null) return 'pending'
  return state.replayHash === state.submittedHash ? 'match' : 'mismatch'
}

/** Page phase for an on-chain round status. */
export function phaseFor(status: RoundStatus): OnchainPhase {
  switch (status) {
    case RoundStatus.BetLocked:
    case RoundStatus.Seeded:
      return 'waitingSeed'
    case RoundStatus.Submitted:
      return 'verifying'
    case RoundStatus.Challenged:
      return 'challenged'
    case RoundStatus.Finalized:
      return 'final'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function useOnchainRound(
  deployment: Deployment,
  dAppKit: AppDAppKit,
  /** Plays the seed on the board; resolves with the replay's result hash (null if it failed). */
  onSeed: (seedHex: string, roundId: bigint) => Promise<string | null>,
) {
  const [state, setState] = useState<OnchainState>(INITIAL)
  // Incremented by every play() and on unmount: an older follow loop sees a new number and stops.
  const runId = useRef(0)
  useEffect(() => () => void runId.current++, [])

  /** Polls the round until it is final, updating the page as it moves. */
  const follow = useCallback(
    async (objectId: string, myRun: number) => {
      const client = dAppKit.getClient()
      let seedPlayed = false
      for (;;) {
        // A failed read (e.g. a network blip) is retried on the next poll.
        const round: RoundView | null = await fetchRound(client, objectId).catch(() => null)
        if (myRun !== runId.current) return
        if (!round) {
          await sleep(POLL_MS)
          continue
        }
        if (round.seed && !seedPlayed) {
          if (round.configVersion !== DEFAULT_CONFIG.version) {
            throw new Error(`round uses physics ${round.configVersion}, this page runs ${DEFAULT_CONFIG.version}`)
          }
          seedPlayed = true
          // Not awaited: the board plays while this loop keeps following the round.
          void onSeed(toHex(round.seed), round.roundId).then((replayHash) => {
            if (myRun === runId.current) setState((s) => ({ ...s, replayHash }))
          })
        }

        const phase = phaseFor(round.status)
        if (phase === 'verifying') {
          const submission = await fetchSubmission(client, deployment, objectId)
          const submittedHash = toHex(submission.resultHash)
          setState((s) => ({ ...s, phase, deadlineMs: submission.deadlineMs, submittedHash }))
        } else if (phase === 'final') {
          // A challenge can be settled between two polls, so always look for a verdict.
          const [finalized, resolved] = await Promise.all([
            findFinalized(client, deployment.packageId, objectId),
            findResolved(client, deployment.packageId, objectId),
          ])
          const resolution = resolved
            ? { operatorHonest: resolved.operator_honest, winner: resolved.winner, awardMist: BigInt(resolved.award) }
            : null
          setState((s) => ({ ...s, phase, payoutMist: finalized ? BigInt(finalized.payout) : null, resolution }))
          return
        } else {
          setState((s) => ({ ...s, phase }))
        }
        await sleep(POLL_MS)
      }
    },
    [dAppKit, deployment, onSeed],
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

  return { state, play, challenge }
}
