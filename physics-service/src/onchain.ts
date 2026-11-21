/**
 * Start-up shared by the on-chain roles (`npm run operator`, `npm run verifier`): the repo-root
 * .env, and a testnet gRPC client (public testnet JSON-RPC is off).
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { TESTNET_GRPC_URL } from '@pachinko/chain'

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url))

/** Loads the repo-root .env into `process.env` (values already set win). */
export function loadRepoEnv() {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
}

export function testnetClient(): SuiGrpcClient {
  return new SuiGrpcClient({ network: 'testnet', baseUrl: process.env.SUI_GRPC_URL?.trim() || TESTNET_GRPC_URL })
}

/** Log line with a timestamp. */
export function log(line: string) {
  console.info(`${new Date().toISOString()}  ${line}`)
}

/**
 * Runs every role's `tick` in turn, one transaction at a time, every `pollMs` until Ctrl+C. A
 * failed tick (e.g. the node is briefly unreachable) is logged; the other roles still run.
 */
export async function runUntilStopped(roles: readonly { tick(): Promise<void> }[], pollMs: number) {
  let running = true
  process.on('SIGINT', () => {
    running = false
  })
  while (running) {
    for (const role of roles) {
      await role.tick().catch((error: unknown) => log(`poll failed: ${error instanceof Error ? error.message : error}`))
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
}
