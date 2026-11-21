/**
 * Verifier loop (step 2 of docs/CONTRACTS.md §1, "resolve", by the committee): finds challenged
 * rounds from `Challenged` events, draws the committee if nobody has, and, for each of its keys
 * that was drawn, re-runs the round and votes the outcomes. The second matching vote settles the
 * round on-chain. One transaction at a time, so a key never competes with itself for gas.
 *
 * For the demo one process runs several verifier keys; in a real pool each verifier runs its own.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import type { Transaction } from '@mysten/sui/transactions'
import {
  Challenged,
  RoundStatus,
  TESTNET_EXPLORER_TX,
  fetchDispute,
  fetchRound,
  selectCommitteeTx,
  signAndExecute,
  voteTx,
  type Deployment,
  type RoundView,
} from '@pachinko/chain'
import { runRound, type MachineConfig } from '@pachinko/physics'
import { RETRY_AFTER_MS } from '../operator/operator'
import { createRoundFeed } from '../operator/roundFeed'
import { verifierAction } from './nextVote'

export interface VerifierDeps {
  readonly client: ClientWithCoreApi
  readonly signers: readonly Signer[]
  readonly deployment: Deployment
  readonly config: MachineConfig
  readonly log: (line: string) => void
}

export function createVerifier({ client, signers, deployment, config, log }: VerifierDeps) {
  /** Challenged rounds still open for this node: object id → earliest time to look again. */
  const rounds = new Map<string, number>()
  const feed = createRoundFeed(client, deployment.packageId, 'Challenged', Challenged)

  async function run(round: RoundView, signer: Signer, label: string, tx: Transaction) {
    const { digest } = await signAndExecute(client, signer, tx)
    log(`round ${round.roundId} ${label.padEnd(8)} ${short(signer.toSuiAddress())}  ${TESTNET_EXPLORER_TX}/${digest}`)
  }

  /** Reads the round and does the next step for each key. Returns true when no key has anything left. */
  async function advance(objectId: string): Promise<boolean> {
    const round = await fetchRound(client, objectId)
    const dispute = round.status === RoundStatus.Challenged ? await fetchDispute(client, deployment, objectId) : null
    const actions = signers.map((signer) => ({
      signer,
      action: verifierAction(round, dispute, signer.toSuiAddress(), Date.now(), config.version),
    }))
    const drawer = actions.find((a) => a.action.kind === 'select')
    if (drawer) {
      // One draw per round; the next tick reads the committee it drew.
      await run(round, drawer.signer, 'draw', selectCommitteeTx(deployment, objectId))
      return false
    }
    const voters = actions.filter((a) => a.action.kind === 'vote')
    if (voters.length > 0) {
      if (!round.seed) throw new Error(`round ${round.roundId} is CHALLENGED but has no seed`)
      const { outcomes } = runRound(round.seed, round.roundId, config)
      for (const { signer } of voters) await run(round, signer, 'vote', voteTx(deployment, objectId, outcomes))
    }
    return voters.length === 0
  }

  return {
    async tick() {
      for (const objectId of await feed.next()) if (!rounds.has(objectId)) rounds.set(objectId, 0)
      for (const [objectId, dueAt] of rounds) {
        if (Date.now() < dueAt) continue
        try {
          if (await advance(objectId)) rounds.delete(objectId)
        } catch (error) {
          log(`round ${objectId}: ${error instanceof Error ? error.message : error} (retrying later)`)
          rounds.set(objectId, Date.now() + RETRY_AFTER_MS)
        }
      }
    },
  }
}

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
