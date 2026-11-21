/**
 * Runs the verifier node for your deployment (PACHINKO_DEPLOYMENT in the repo-root .env) with the
 * keys in VERIFIER_PRIVATE_KEYS (comma-separated). Register them first with `npm run verifiers:setup`.
 * Usage: `npm run verifier` (repo root). Stop with Ctrl+C.
 */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fetchPoolMembers } from '@pachinko/chain'
import { deploymentName, loadDeployment } from '@pachinko/chain/node'
import { DEFAULT_CONFIG, initPhysics } from '@pachinko/physics'
import { loadRepoEnv, log, runUntilStopped, testnetClient } from '../onchain'
import { createVerifier } from './verifier'

const POLL_MS = 2_000

async function main() {
  loadRepoEnv()
  const keys = (process.env.VERIFIER_PRIVATE_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean)
  if (keys.length === 0) throw new Error('set VERIFIER_PRIVATE_KEYS in .env (comma-separated), then npm run verifiers:setup')
  const signers = keys.map((k) => Ed25519Keypair.fromSecretKey(k))
  const client = testnetClient()
  const name = deploymentName()
  const deployment = loadDeployment(name)
  await initPhysics()

  const members = await fetchPoolMembers(client, deployment)
  log(`verifier node on deployment ${name} (${deployment.packageId}, ${DEFAULT_CONFIG.version})`)
  for (const signer of signers) {
    const address = signer.toSuiAddress()
    log(`  ${address} ${members.includes(address) ? 'in the pool' : 'NOT in the pool: run npm run verifiers:setup'}`)
  }

  const verifier = createVerifier({ client, signers, deployment, config: DEFAULT_CONFIG, log })
  await runUntilStopped([verifier], POLL_MS)
  log('verifier stopped')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
