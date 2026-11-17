/**
 * One honest pachinko round on Sui testnet:
 *
 *   publish → create + fund house → create round (bet locked) → draw seed (sui::random)
 *   → runRound off-chain → submit result (hash checked on-chain) → wait out the window → finalize
 *
 * Prints every transaction digest with an explorer link. One key plays admin, operator and player.
 * Usage: `npm run round:testnet` (needs SUI_PRIVATE_KEY in .env). Contract: docs/SPEC.md §7.
 */
import { loadEnv } from './env'
import { seededRound, submitResult, waitForDeadline, finalize } from './steps'
import { connect } from './sui'

async function main() {
  const env = loadEnv()
  const sui = connect(env.grpcUrl, env.privateKey)
  console.log(`address          ${sui.address}\n`)

  const { deployment, round, result } = await seededRound(sui, env)
  const deadlineMs = await submitResult(sui, env, deployment, round, result.outcomes, result.resultHash)
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
