/**
 * Deploys the contracts to testnet once: publish → create House (+ OperatorCap) → fund House,
 * then writes the ids to chain/src/deployments/testnet.json, which every other part imports.
 * The deploying key holds the AdminCap and OperatorCap. Commit the JSON after a redeploy.
 * Usage: `npm run deploy:testnet` (needs SUI_PRIVATE_KEY in .env; settings in .env.example).
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadEnv } from './env'
import { deploy } from './steps'
import { connect } from './sui'

const DEPLOYMENT_FILE = fileURLToPath(new URL('../../chain/src/deployments/testnet.json', import.meta.url))

async function main() {
  const env = loadEnv()
  const sui = connect(env.grpcUrl, env.privateKey)
  console.log(`address          ${sui.address}\n`)

  const deployment = await deploy(sui, env)
  writeFileSync(DEPLOYMENT_FILE, `${JSON.stringify(deployment, null, 2)}\n`)
  console.log(`\npackage          ${deployment.packageId}`)
  console.log(`saved            chain/src/deployments/testnet.json`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
