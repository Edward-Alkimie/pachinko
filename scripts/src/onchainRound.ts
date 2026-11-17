/**
 * One honest pachinko round on Sui testnet:
 *
 *   create round (bet locked) → draw seed (sui::random) → runRound off-chain
 *   → submit result (hash checked on-chain) → wait out the window → finalize
 *
 * Uses the saved testnet deployment (`npm run deploy:testnet` first). Prints every digest.
 * The key plays player and operator, so it must be the deploying key (it holds the OperatorCap).
 * Usage: `npm run round:testnet` (needs SUI_PRIVATE_KEY in .env). Contract: docs/SPEC.md §7.
 */
import { testnetDeployment } from '@pachinko/chain'
import { loadEnv } from './env'
import { seededRound, submitResult, waitForDeadline, finalize } from './steps'
import { connect } from './sui'

async function main() {
  const env = loadEnv()
  const sui = connect(env.grpcUrl, env.privateKey)
  console.log(`address          ${sui.address}\n`)

  const deployment = testnetDeployment()
  const { round, result } = await seededRound(sui, env, deployment)
  const deadlineMs = await submitResult(sui, deployment, round, result.outcomes, result.resultHash)
  await waitForDeadline(deadlineMs)
  const payout = await finalize(sui, deployment, round)

  console.log(`\npackage          ${deployment.packageId}`)
  console.log(`round object     ${round.objectId}`)
  console.log(`bet → payout     ${env.betMist} → ${payout} MIST`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
