/**
 * Funds and registers the demo verifiers (docs/CONTRACTS.md §11): for each key in
 * VERIFIER_PRIVATE_KEYS that is not in the pool yet, the main key (SUI_PRIVATE_KEY) sends it the
 * verifier stake plus gas, and the verifier joins the pool with its own key. Safe to re-run.
 * Usage: `npm run verifiers:setup`; then `npm run verifier` runs them.
 */
import { fetchPoolMembers } from '@pachinko/chain'
import { loadDeployment } from '@pachinko/chain/node'
import { loadEnv } from './env'
import { fund, joinPool } from './steps'
import { connect } from './sui'

/** Gas each verifier gets on top of its stake: joining, drawing and voting cost well under this. */
const VERIFIER_GAS_MIST = 50_000_000n
/** A committee draws this many, never the operator, challenger or player. */
const COMMITTEE_SIZE = 3

async function main() {
  const env = loadEnv()
  if (env.verifierPrivateKeys.length < COMMITTEE_SIZE) {
    throw new Error(`set at least ${COMMITTEE_SIZE} comma-separated keys in VERIFIER_PRIVATE_KEYS (.env)`)
  }
  const funder = connect(env.grpcUrl, env.privateKey)
  const deployment = loadDeployment()
  const stake = BigInt(deployment.house.verifierStakeMist)
  const members = await fetchPoolMembers(funder.client, deployment)

  for (const key of env.verifierPrivateKeys) {
    const verifier = connect(env.grpcUrl, key)
    console.log(`verifier         ${verifier.address}`)
    if (members.includes(verifier.address)) {
      console.log('  already in the pool')
      continue
    }
    await fund(funder, verifier.address, stake + VERIFIER_GAS_MIST)
    await joinPool(verifier, deployment)
  }
  const pool = await fetchPoolMembers(funder.client, deployment)
  console.log(`\npool             ${pool.length} verifiers, stake ${stake} MIST each`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
