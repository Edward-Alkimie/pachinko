/**
 * The player's side only: place a bet, then follow the round until it is final. The operator
 * (`npm run operator`) does the rest: draw seed → physics → submit → finalize.
 *
 * Player-side check (docs/CONTRACTS.md §1, step 1 "detect"): once the result is submitted, this
 * replays the seed and compares hashes. On a mismatch it challenges inside the window; the
 * arbiter (in `npm run operator`) then settles the round.
 * Usage: `npm run bet:testnet` (needs SUI_PRIVATE_KEY + PACHINKO_DEPLOYMENT in .env and that
 * deployment's operator running).
 */
import {
  RoundStatus,
  fetchRound,
  fetchSubmission,
  findFinalized,
  findResolved,
  type Deployment,
  type RoundView,
} from '@pachinko/chain'
import { loadDeployment } from '@pachinko/chain/node'
import { DEFAULT_CONFIG, initPhysics, runRound } from '@pachinko/physics'
import { toHex } from '@mysten/sui/utils'
import { loadEnv } from './env'
import { challenge, createRound } from './steps'
import { connect, type Sui } from './sui'

const POLL_MS = 2_000
const STATUS_NAME = ['BET_LOCKED', 'SEEDED', 'SUBMITTED', 'CHALLENGED', 'FINALIZED']

/** Replays the round and compares with the submitted hash; challenges on a mismatch. */
async function checkResult(sui: Sui, deployment: Deployment, round: RoundView) {
  if (!round.seed) throw new Error(`round ${round.roundId} is SUBMITTED but has no seed`)
  const replayHash = runRound(round.seed, round.roundId, DEFAULT_CONFIG).resultHash
  const submission = await fetchSubmission(sui.client, deployment, round.objectId)
  const submittedHash = toHex(submission.resultHash)
  console.log(`  replay hash      ${replayHash}`)
  console.log(`  submitted hash   ${submittedHash}`)
  if (replayHash === submittedHash) {
    console.log('  ✓ match: the operator ran the physics honestly')
    return
  }
  console.log('  ✗ MISMATCH: the submitted result is not what the physics gives. Challenging…')
  await challenge(sui, deployment, round)
}

async function main() {
  const env = loadEnv()
  const sui = connect(env.grpcUrl, env.privateKey)
  const deployment = loadDeployment()
  await initPhysics()
  console.log(`player           ${sui.address}\n`)

  const round = await createRound(sui, env, deployment)
  let status = -1
  while (status !== RoundStatus.Finalized) {
    const view = await fetchRound(sui.client, round.objectId)
    if (view.status !== status) {
      status = view.status
      const seed = status === RoundStatus.Seeded && view.seed ? `  seed ${toHex(view.seed)}` : ''
      const note = status === RoundStatus.Challenged ? '  (waiting for the arbiter)' : ''
      console.log(`  ${new Date().toISOString()}  ${STATUS_NAME[status]}${seed}${note}`)
      if (status === RoundStatus.Submitted) await checkResult(sui, deployment, view)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  // A challenge can be settled between two polls, so look for the verdict instead of the status.
  const finalized = await findFinalized(sui.client, deployment.packageId, round.objectId)
  const resolved = await findResolved(sui.client, deployment.packageId, round.objectId)
  console.log(`\nround object     ${round.objectId}`)
  if (resolved) {
    const verdict = resolved.operator_honest ? 'operator honest' : 'operator forged'
    console.log(`verdict          ${verdict}, bonds ${resolved.award} MIST → ${resolved.winner}`)
  }
  console.log(`bet → payout     ${env.betMist} → ${finalized?.payout ?? '?'} MIST`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
