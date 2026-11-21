/**
 * useVerifyRound: reads any round of the deployment from the chain, and checks it by replaying it on the board.
 *
 *   verify(n)       → findRoundByNumber (RoundCreated) → fetchRound (status, seed) + fetchRoundHistory (events)
 *   replayOnBoard() → playOnBoard(seed, round_id): the board animates the round and resolves with its
 *                     result hash once the balls land (null if cut short) → replayHash
 *
 * Nothing runs out of sight: the check is the replay the reader watches, as on the Play view.
 * With a replay, the page compares it with what was submitted and what was paid (`verdictOf`).
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
import { DEFAULT_CONFIG } from '@pachinko/physics'

export interface VerifiedRound {
  readonly round: RoundView
  /** The bet as placed (the Round itself holds 0 once it is settled). */
  readonly betMist: bigint
  readonly seedHex: string | null
  /** This page can replay the round: the seed is drawn and the round uses this page's physics version. */
  readonly canReplay: boolean
  /** Result hash of the board's replay, once the balls have landed. */
  readonly replayHash: string | null
  readonly history: RoundHistory
}

export type VerifyState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading'; readonly roundId: bigint }
  | { readonly status: 'done'; readonly roundId: bigint; readonly result: VerifiedRound; readonly replay: BoardReplay }
  | { readonly status: 'error'; readonly roundId: bigint; readonly error: string }

/** The board's replay of the shown round: `interrupted` = the board was given another round first. */
export type BoardReplay = 'none' | 'playing' | 'done' | 'interrupted'

export function useVerifyRound(
  deployment: Deployment,
  client: ClientWithCoreApi,
  /** Plays a round on the board; resolves with the replay's result hash once the balls land (null if cut short). */
  playOnBoard: (seedHex: string, roundId: bigint) => Promise<string | null>,
) {
  const [state, setState] = useState<VerifyState>({ status: 'idle' })
  // A newer verify() makes an older, slower one drop its result.
  const runId = useRef(0)
  // A newer replayOnBoard() makes an older one (cut short by it) drop its outcome.
  const replayId = useRef(0)
  // The board is playing a round this hook started (so verifying another round may take it over).
  const [ownReplayPlaying, setOwnReplayPlaying] = useState(false)

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
        const seedHex = round.seed ? toHex(round.seed) : null
        const canReplay = round.seed !== null && round.configVersion === DEFAULT_CONFIG.version
        const result = { round, betMist: BigInt(created.bet), seedHex, canReplay, replayHash: null, history }
        if (myRun === runId.current) setState({ status: 'done', roundId, result, replay: 'none' })
      } catch (err) {
        if (myRun !== runId.current) return
        setState({ status: 'error', roundId, error: err instanceof Error ? err.message : String(err) })
      }
    },
    [client, deployment],
  )

  /** Plays the shown round on the board; its hash, once the balls land, is the page's check. */
  const replayOnBoard = useCallback(async () => {
    if (state.status !== 'done' || !state.result.canReplay || state.result.seedHex === null) return
    const myRun = runId.current
    const myReplay = ++replayId.current
    setState((s) => (s.status === 'done' ? { ...s, replay: 'playing' } : s))
    setOwnReplayPlaying(true)
    const replayHash = await playOnBoard(state.result.seedHex, state.result.round.roundId)
    if (myReplay !== replayId.current) return
    setOwnReplayPlaying(false)
    if (myRun !== runId.current) return
    setState((s) => {
      if (s.status !== 'done') return s
      // A cut-short replay keeps any hash an earlier, complete one gave.
      if (replayHash === null) return { ...s, replay: 'interrupted' }
      return { ...s, replay: 'done', result: { ...s.result, replayHash } }
    })
  }, [state, playOnBoard])

  return { state, verify, replayOnBoard, ownReplayPlaying }
}
