/**
 * Arbiter loop, the fallback of step 2 in docs/CONTRACTS.md §1 ("resolve"): finds rounds from
 * `Challenged` events and, for any still CHALLENGED once the committee's vote deadline has passed,
 * re-runs the physics and settles it with `resolve_by_admin`. The contract compares the true hash
 * with the submitted one: the dishonest side loses its bond, and the player is paid from the true
 * outcomes. Rounds the committee settles in time are simply dropped. Needs the AdminCap key.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import {
  Challenged,
  Resolved,
  RoundStatus,
  TESTNET_EXPLORER_TX,
  eventType,
  fetchDispute,
  fetchRound,
  readEvent,
  resolveByAdminTx,
  signAndExecute,
  type Deployment,
} from '@pachinko/chain'
import { runRound, type MachineConfig } from '@pachinko/physics'
import { arbiterAction } from './nextAction'
import { RETRY_AFTER_MS } from './operator'
import { createRoundFeed } from './roundFeed'

export interface ArbiterDeps {
  readonly client: ClientWithCoreApi
  readonly signer: Signer
  readonly deployment: Deployment
  readonly config: MachineConfig
  readonly log: (line: string) => void
}

export interface Arbiter {
  /** Picks up new challenges, then settles every challenged round that is due. */
  tick(): Promise<void>
}

export function createArbiter({ client, signer, deployment, config, log }: ArbiterDeps): Arbiter {
  /** Challenged rounds not yet settled: object id → earliest time to try again. */
  const rounds = new Map<string, number>()
  const feed = createRoundFeed(client, deployment.packageId, 'Challenged', Challenged)

  async function settle(objectId: string) {
    const round = await fetchRound(client, objectId)
    const voteDeadlineMs =
      round.status === RoundStatus.Challenged ? (await fetchDispute(client, deployment, objectId)).deadlineMs : null
    const action = arbiterAction(round, voteDeadlineMs, Date.now(), config.version)
    if (action.kind === 'drop') {
      rounds.delete(objectId)
      log(`round ${round.roundId} arbiter done: ${action.reason}`)
      return
    }
    if (action.kind === 'wait') {
      rounds.set(objectId, action.untilMs)
      return
    }
    if (!round.seed) throw new Error(`round ${round.roundId} is CHALLENGED but has no seed`)
    const { outcomes } = runRound(round.seed, round.roundId, config)
    const executed = await signAndExecute(client, signer, resolveByAdminTx(deployment, objectId, outcomes))
    const resolved = readEvent(executed, eventType(deployment.packageId, 'Resolved'), Resolved)
    rounds.delete(objectId)
    const verdict = resolved.operator_honest ? 'operator honest' : 'operator forged'
    log(`round ${round.roundId} fallback  ${verdict}, ${resolved.award} MIST → ${resolved.winner}  ${TESTNET_EXPLORER_TX}/${executed.digest}`)
  }

  return {
    async tick() {
      for (const objectId of await feed.next()) if (!rounds.has(objectId)) rounds.set(objectId, 0)
      for (const [objectId, dueAt] of rounds) {
        if (Date.now() < dueAt) continue
        try {
          await settle(objectId)
        } catch (error) {
          log(`round ${objectId}: ${error instanceof Error ? error.message : error} (arbiter retrying later)`)
          rounds.set(objectId, Date.now() + RETRY_AFTER_MS)
        }
      }
    },
  }
}
