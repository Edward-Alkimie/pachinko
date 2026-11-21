/**
 * Runs the operator for your deployment (PACHINKO_DEPLOYMENT in the repo-root .env), and the
 * fallback arbiter too when the same key holds the AdminCap (the normal case: the key that deployed).
 * Both run in this one process, one transaction at a time, so they never compete for the key's
 * gas coin. Key: OPERATOR_PRIVATE_KEY (must own that deployment's OperatorCap), or SUI_PRIVATE_KEY
 * when unset. Demo only: OPERATOR_CHEAT=shortchange forges every result (see ./cheat.ts).
 * Usage: `npm run operator` (repo root). Stop with Ctrl+C.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { deploymentName, loadDeployment } from '@pachinko/chain/node'
import { DEFAULT_CONFIG, initPhysics } from '@pachinko/physics'
import { loadRepoEnv, log, runUntilStopped, testnetClient } from '../onchain'
import { createArbiter } from './arbiter'
import { parseCheat } from './cheat'
import { createOperator } from './operator'

const POLL_MS = 2_000

function operatorKey(): string {
  loadRepoEnv()
  const key = process.env.OPERATOR_PRIVATE_KEY?.trim() || process.env.SUI_PRIVATE_KEY?.trim()
  if (!key) throw new Error('set OPERATOR_PRIVATE_KEY (or SUI_PRIVATE_KEY) in .env')
  return key
}

/** Address that owns `objectId` (e.g. a cap), or `null` if no single address does. */
async function ownerOf(client: ClientWithCoreApi, objectId: string): Promise<string | null> {
  const { object } = await client.core.getObject({ objectId })
  return object.owner.$kind === 'AddressOwner' ? object.owner.AddressOwner : null
}

async function main() {
  const signer = Ed25519Keypair.fromSecretKey(operatorKey())
  const address = signer.toSuiAddress()
  const client = testnetClient()
  const name = deploymentName()
  const deployment = loadDeployment(name)
  const operatorCapOwner = await ownerOf(client, deployment.operatorCapId)
  if (operatorCapOwner !== address) {
    const owner = operatorCapOwner ?? 'no address'
    throw new Error(`OperatorCap ${deployment.operatorCapId} belongs to ${owner}, not ${address}`)
  }
  const adminCapOwner = await ownerOf(client, deployment.adminCapId)
  await initPhysics()

  const cheat = parseCheat(process.env.OPERATOR_CHEAT)
  const operator = createOperator({ client, signer, deployment, config: DEFAULT_CONFIG, cheat, log })
  const arbiter =
    adminCapOwner === address ? createArbiter({ client, signer, deployment, config: DEFAULT_CONFIG, log }) : null
  log(`operator ${address} on deployment ${name} (${deployment.packageId}, ${DEFAULT_CONFIG.version})`)
  log(
    arbiter
      ? 'arbiter on: settles challenged rounds the committee leaves undecided'
      : `arbiter off: the AdminCap belongs to ${adminCapOwner}`,
  )
  if (cheat) log(`CHEATING (OPERATOR_CHEAT=${cheat}): every result is forged. Demo only.`)

  await runUntilStopped(arbiter ? [operator, arbiter] : [operator], POLL_MS)
  log('operator stopped')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
