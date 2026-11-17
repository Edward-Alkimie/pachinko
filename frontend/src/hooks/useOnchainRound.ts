/**
 * useOnchainRound: plays one round on Sui testnet from the player's wallet.
 *
 *   play() → wallet signs create_round (bet locked)          phase 'signing'
 *          → operator draws the seed                          phase 'waitingSeed'
 *          → seed appears: onSeed(seed, round_id) plays it    (the existing useRound animation)
 *          → operator submits; challenge window runs           phase 'verifying'
 *          → operator finalizes; payout read from Finalized    phase 'final'
 *
 * The page only reads the chain (polls the Round); the operator (physics-service) does the rest.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toHex } from '@mysten/sui/utils'
import {
  RoundCreated,
  RoundStatus,
  createRoundTx,
  eventType,
  fetchRound,
  fetchSubmission,
  findFinalized,
  type Deployment,
  type RoundView,
} from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import type { AppDAppKit } from '../onchain/dappKit'

/** Bet per on-chain round: 0.01 SUI. */
export const BET_MIST = 10_000_000n
const POLL_MS = 1_500

export type OnchainPhase = 'idle' | 'signing' | 'waitingSeed' | 'verifying' | 'challenged' | 'final' | 'error'

export interface OnchainState {
  readonly phase: OnchainPhase
  readonly roundObjectId: string | null
  readonly roundId: bigint | null
  readonly createDigest: string | null
  /** End of the challenge window (chain ms), once the result is submitted. */
  readonly deadlineMs: number | null
  readonly payoutMist: bigint | null
  readonly error: string | null
}

const INITIAL: OnchainState = {
  phase: 'idle',
  roundObjectId: null,
  roundId: null,
  createDigest: null,
  deadlineMs: null,
  payoutMist: null,
  error: null,
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
  onSeed: (seedHex: string, roundId: bigint) => void,
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
          onSeed(toHex(round.seed), round.roundId)
        }

        const phase = phaseFor(round.status)
        if (phase === 'verifying') {
          const { deadlineMs } = await fetchSubmission(client, deployment, objectId)
          setState((s) => ({ ...s, phase, deadlineMs }))
        } else if (phase === 'final') {
          const finalized = await findFinalized(client, deployment.packageId, objectId)
          setState((s) => ({ ...s, phase, payoutMist: finalized ? BigInt(finalized.payout) : null }))
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

  return { state, play }
}
