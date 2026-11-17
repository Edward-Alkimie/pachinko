/**
 * The player's side only: place a bet, then follow the round until it is final. The operator
 * (`npm run operator`) does the rest: draw seed → physics → submit → finalize.
 * Usage: `npm run bet:testnet` (needs SUI_PRIVATE_KEY + PACHINKO_DEPLOYMENT in .env and that
 * deployment's operator running).
 */
import { RoundStatus, fetchRound, findFinalized } from '@pachinko/chain'
import { loadDeployment } from '@pachinko/chain/node'
import { toHex } from '@mysten/sui/utils'
import { loadEnv } from './env'
import { createRound } from './steps'
import { connect } from './sui'

const POLL_MS = 2_000
const STATUS_NAME = ['BET_LOCKED', 'SEEDED', 'SUBMITTED', 'CHALLENGED', 'FINALIZED']

async function main() {
  const env = loadEnv()
  const sui = connect(env.grpcUrl, env.privateKey)
  const deployment = loadDeployment()
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
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }

  const finalized = await findFinalized(sui.client, deployment.packageId, round.objectId)
  console.log(`\nround object     ${round.objectId}`)
  console.log(`bet → payout     ${env.betMist} → ${finalized?.payout ?? '?'} MIST`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
