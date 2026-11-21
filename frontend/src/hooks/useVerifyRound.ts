/**
 * useVerifyRound: checks any round of the deployment from the chain alone.
 *
 *   verify(n) → findRoundByNumber (RoundCreated) → fetchRound (status, seed)
 *             → this browser replays the seed with runRound → fetchRoundHistory (its events)
 *
 * The page then compares the replay with what was submitted and what was paid (`verdictOf`).
 */
import { useCallback, useRef, useState } from 'react'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { toHex } from '@mysten/sui/utils'
import {
  fetchRound,
  fetchRoundHistory,
  findRoundByNumber,
  type Deployment,
  type RoundHistory,
  type RoundView,
} from '@pachinko/chain'
import { DEFAULT_CONFIG, initPhysics, runRound } from '@pachinko/physics'

export interface VerifiedRound {
  readonly round: RoundView
  /** The bet as placed (the Round itself holds 0 once it is settled). */
  readonly betMist: bigint
  readonly seedHex: string | null
  /** This browser's replay of the seed (null before the seed is drawn, or for another physics version). */
  readonly replayHash: string | null
  readonly history: RoundHistory
}

export type VerifyState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly roundId: bigint }
  | { readonly status: 'done'; readonly roundId: bigint; readonly result: VerifiedRound }
  | { readonly status: 'error'; readonly roundId: bigint; readonly error: string }

export function useVerifyRound(deployment: Deployment, client: ClientWithCoreApi) {
  const [state, setState] = useState<VerifyState>({ status: 'idle' })
  // A newer verify() makes an older, slower one drop its result.
  const runId = useRef(0)

  const verify = useCallback(
    async (roundId: bigint) => {
      const myRun = ++runId.current
      setState({ status: 'loading', roundId })
      try {
        const created = await findRoundByNumber(client, deployment.packageId, roundId)
        if (!created) throw new Error(`No round #${roundId} on this deployment.`)
        const [round, history] = await Promise.all([
          fetchRound(client, created.round),
          fetchRoundHistory(client, deployment.packageId, created.round),
        ])
        let replayHash: string | null = null
        if (round.seed && round.configVersion === DEFAULT_CONFIG.version) {
          await initPhysics()
          replayHash = runRound(round.seed, round.roundId, DEFAULT_CONFIG).resultHash
        }
        const seedHex = round.seed ? toHex(round.seed) : null
        const result = { round, betMist: BigInt(created.bet), seedHex, replayHash, history }
        if (myRun === runId.current) setState({ status: 'done', roundId, result })
      } catch (err) {
        if (myRun !== runId.current) return
        setState({ status: 'error', roundId, error: err instanceof Error ? err.message : String(err) })
      }
    },
    [client, deployment],
  )

  return { state, verify }
}
