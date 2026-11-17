/**
 * Node only (`@pachinko/chain/node`): the named deployment files `deployments/<name>.json`.
 * Each teammate deploys their own copy of the contracts and picks it with PACHINKO_DEPLOYMENT
 * in the repo-root .env, so scripts and operators never act on someone else's deployment.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEPLOYMENT_NAME, parseDeployment, type Deployment } from './deployment'

const DEPLOYMENTS_DIR = new URL('./deployments/', import.meta.url)

/** Names of the deployments in the repo, e.g. `['kevin', 'kiana']`. */
export function deploymentNames(): string[] {
  return readdirSync(DEPLOYMENTS_DIR)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -'.json'.length))
    .sort()
}

/** Repo-relative path of a deployment file, for messages. */
export function deploymentPath(name: string): string {
  return `chain/src/deployments/${name}.json`
}

/** The name in PACHINKO_DEPLOYMENT. Load .env before calling. */
export function deploymentName(): string {
  const name = process.env.PACHINKO_DEPLOYMENT?.trim()
  if (!name) {
    throw new Error(
      `set PACHINKO_DEPLOYMENT in .env to your deployment name (existing: ${deploymentNames().join(', ') || 'none'})`,
    )
  }
  if (!DEPLOYMENT_NAME.test(name)) {
    throw new Error(`PACHINKO_DEPLOYMENT must be lowercase letters, digits and dashes (got "${name}")`)
  }
  return name
}

/** Reads and checks a deployment (default: the one in PACHINKO_DEPLOYMENT). */
export function loadDeployment(name: string = deploymentName()): Deployment {
  const file = fileURLToPath(new URL(`${name}.json`, DEPLOYMENTS_DIR))
  if (!existsSync(file)) {
    throw new Error(`no deployment "${name}": run \`npm run deploy:testnet\` with PACHINKO_DEPLOYMENT=${name}`)
  }
  return parseDeployment(JSON.parse(readFileSync(file, 'utf8')))
}

/** Writes a deployment file (a redeploy replaces it). */
export function saveDeployment(name: string, deployment: Deployment) {
  writeFileSync(new URL(`${name}.json`, DEPLOYMENTS_DIR), `${JSON.stringify(deployment, null, 2)}\n`)
}
