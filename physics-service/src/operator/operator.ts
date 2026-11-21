/**
 * Operator loop: finds rounds from `RoundCreated` events and moves each one forward with
 * `nextAction` (one transaction per round per tick). Rounds are handled one at a time, so the
 * operator's transactions never compete for its gas coin. A failed step is retried later.
 *
 * Flow per round: draw seed → runRound(seed, round_id) → submit result → finalize after the window.
 * Contract: docs/SPEC.md §7. Plan: docs/CONTRACTS.md §10.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import type { Transaction } from '@mysten/sui/transactions'
import {
  RoundCreated,
  RoundStatus,
  TESTNET_EXPLORER_TX,
  drawSeedTx,
  fetchRound,
  fetchSubmission,
  finalizeTx,
  signAndExecute,
  submitResultTx,
  type Deployment,
  type RoundView,
} from '@pachinko/chain'
import { hashRoundResult, runRound, type MachineConfig } from '@pachinko/physics'
import { forgeOutcomes, type Cheat } from './cheat'
import { nextAction } from './nextAction'
import { createRoundFeed } from './roundFeed'

/** Wait before retrying a round whose last step failed. */
export const RETRY_AFTER_MS = 30_000

export interface OperatorDeps {
  readonly client: ClientWithCoreApi
  readonly signer: Signer
  readonly deployment: Deployment
  readonly config: MachineConfig
  /** Demo only: submit a forged result instead of the physics result (`null` = honest). */
  readonly cheat: Cheat | null
  readonly log: (line: string) => void
}

export interface Operator {
  /** Picks up new rounds, then advances every round that is due. */
  tick(): Promise<void>
}

export function createOperator({ client, signer, deployment, config, cheat, log }: OperatorDeps): Operator {
  /** Rounds still in progress: object id → earliest time to look at it again. */
  const rounds = new Map<string, number>()
  const feed = createRoundFeed(client, deployment.packageId, 'RoundCreated', RoundCreated)

  async function run(round: RoundView, label: string, tx: Transaction) {
    const { digest } = await signAndExecute(client, signer, tx)
    log(`round ${round.roundId} ${label.padEnd(8)} ${TESTNET_EXPLORER_TX}/${digest}`)
  }

  /** A forged result for `cheat`, with the hash that matches it (so the on-chain check passes). */
  function forged(seed: Uint8Array, roundId: bigint, cheat: Cheat) {
    const honest = runRound(seed, roundId, config).outcomes
    const outcomes = forgeOutcomes(cheat, honest)
    return { outcomes, resultHash: hashRoundResult({ version: config.version, seed, roundId, outcomes }) }
  }

  /** Reads the round and does its next step. */
  async function advance(objectId: string) {
    const round = await fetchRound(client, objectId)
    const deadlineMs =
      round.status === RoundStatus.Submitted
        ? (await fetchSubmission(client, deployment, objectId)).deadlineMs
        : null
    const action = nextAction(round, deadlineMs, Date.now(), config.version)

    switch (action.kind) {
      case 'drawSeed':
        return run(round, 'seed', drawSeedTx(deployment, objectId))
      case 'submit': {
        if (!round.seed) throw new Error(`round ${round.roundId} is SEEDED but has no seed`)
        const { outcomes, resultHash } = cheat
          ? forged(round.seed, round.roundId, cheat)
          : runRound(round.seed, round.roundId, config)
        const label = cheat ? `submit (forged: ${cheat})` : 'submit'
        return run(round, label, submitResultTx(deployment, objectId, outcomes, resultHash))
      }
      case 'wait':
        rounds.set(objectId, action.untilMs)
        return
      case 'finalize':
        return run(round, 'finalize', finalizeTx(deployment, objectId))
      case 'drop':
        rounds.delete(objectId)
        log(`round ${round.roundId} done: ${action.reason}`)
    }
  }

  return {
    async tick() {
      for (const objectId of await feed.next()) if (!rounds.has(objectId)) rounds.set(objectId, 0)
      for (const [objectId, dueAt] of rounds) {
        if (Date.now() < dueAt) continue
        try {
          await advance(objectId)
        } catch (error) {
          log(`round ${objectId}: ${error instanceof Error ? error.message : error} (retrying later)`)
          rounds.set(objectId, Date.now() + RETRY_AFTER_MS)
        }
      }
    },
  }
}
