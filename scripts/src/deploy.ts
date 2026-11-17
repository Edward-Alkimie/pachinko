/**
 * Deploys your own copy of the contracts to testnet: publish → create House (+ OperatorCap) →
 * fund House, then saves the ids as chain/src/deployments/<PACHINKO_DEPLOYMENT>.json (commit it).
 * The deploying key holds that deployment's AdminCap and OperatorCap. A redeploy replaces the file.
 * Usage: `npm run deploy:testnet` (needs SUI_PRIVATE_KEY + PACHINKO_DEPLOYMENT in .env).
 */
import { deploymentName, deploymentPath, saveDeployment } from '@pachinko/chain/node'
import { loadEnv } from './env'
import { deploy } from './steps'
import { connect } from './sui'

async function main() {
  const env = loadEnv()
  const name = deploymentName()
  const sui = connect(env.grpcUrl, env.privateKey)
  console.log(`address          ${sui.address}`)
  console.log(`deployment       ${name}\n`)

  const deployment = await deploy(sui, env)
  saveDeployment(name, deployment)
  console.log(`\npackage          ${deployment.packageId}`)
  console.log(`saved            ${deploymentPath(name)}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
