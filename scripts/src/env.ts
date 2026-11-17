/**
 * Settings for the on-chain round script, read from the repo-root `.env` (see `.env.example`).
 * Only the private key is required; everything else has a testnet-friendly default.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ENV_FILE = fileURLToPath(new URL('../../.env', import.meta.url))

export interface ScriptEnv {
  /** `suiprivkey1…` (Bech32). Used as admin, operator and player in this demo. */
  readonly privateKey: string
  readonly grpcUrl: string
  readonly betMist: bigint
  readonly houseFundsMist: bigint
  readonly operatorBondMist: bigint
  readonly challengerBondMist: bigint
  readonly challengeWindowMs: bigint
  /** Payout per pocket in basis points (10 000 = 1×), one per physics pocket. */
  readonly multipliersBps: readonly bigint[]
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback
}

function mist(name: string, fallback: string): bigint {
  const value = optional(name, fallback)
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number (got "${value}")`)
  return BigInt(value)
}

export function loadEnv(): ScriptEnv {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
  const privateKey = process.env.SUI_PRIVATE_KEY?.trim()
  if (!privateKey) {
    throw new Error('SUI_PRIVATE_KEY is not set: add it to .env (see .env.example)')
  }
  return {
    privateKey,
    grpcUrl: optional('SUI_GRPC_URL', 'https://fullnode.testnet.sui.io:443'),
    betMist: mist('PACHINKO_BET_MIST', '10000000'),
    houseFundsMist: mist('PACHINKO_HOUSE_FUNDS_MIST', '50000000'),
    operatorBondMist: mist('PACHINKO_OPERATOR_BOND_MIST', '10000000'),
    challengerBondMist: mist('PACHINKO_CHALLENGER_BOND_MIST', '10000000'),
    challengeWindowMs: mist('PACHINKO_CHALLENGE_WINDOW_MS', '30000'),
    multipliersBps: optional('PACHINKO_MULTIPLIERS_BPS', '10000,10000,10000,10000,10000,10000,10000')
      .split(',')
      .map((part, i) => {
        if (!/^\d+$/.test(part.trim())) throw new Error(`PACHINKO_MULTIPLIERS_BPS[${i}] is not a number`)
        return BigInt(part.trim())
      }),
  }
}
