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
  eventType,
  fetchRound,
  fetchSubmission,
  finalizeTx,
  signAndExecute,
  submitResultTx,
  type Deployment,
  type RoundView,
} from '@pachinko/chain'
import { runRound, type MachineConfig } from '@pachinko/physics'
import { nextAction } from './nextAction'

/** Wait before retrying a round whose last step failed. */
const RETRY_AFTER_MS = 30_000

export interface OperatorDeps {
  readonly client: ClientWithCoreApi
  readonly signer: Signer
  readonly deployment: Deployment
  readonly config: MachineConfig
  readonly log: (line: string) => void
}

export interface Operator {
  /** Picks up new rounds, then advances every round that is due. */
  tick(): Promise<void>
}

export function createOperator({ client, signer, deployment, config, log }: OperatorDeps): Operator {
  /** Rounds still in progress: object id → earliest time to look at it again. */
  const rounds = new Map<string, number>()
  let cursor: string | null = null

  async function discoverRounds() {
    let hasNextPage = true
    while (hasNextPage) {
      const page = await client.core.listEvents({
        filter: { eventType: eventType(deployment.packageId, 'RoundCreated') },
        after: cursor,
      })
      for (const event of page.events) {
        const created = RoundCreated.parse(event.bcs)
        if (!rounds.has(created.round)) rounds.set(created.round, 0)
      }
      cursor = page.endCursor ?? cursor
      hasNextPage = page.hasNextPage
    }
  }

  async function run(round: RoundView, label: string, tx: Transaction) {
    const { digest } = await signAndExecute(client, signer, tx)
    log(`round ${round.roundId} ${label.padEnd(8)} ${TESTNET_EXPLORER_TX}/${digest}`)
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
        const result = runRound(round.seed, round.roundId, config)
        return run(round, 'submit', submitResultTx(deployment, objectId, result.outcomes, result.resultHash))
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
      await discoverRounds()
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
