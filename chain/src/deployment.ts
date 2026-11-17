/**
 * Ids and House settings of one deployment of `contracts/pachinko`. All ids are public.
 * u64 amounts are decimal strings so the shape round-trips through JSON.
 * Each teammate has their own: `deployments/<name>.json` (read and written by `./node.ts`).
 */

export interface HouseSettings {
  /** Payout per pocket in basis points (10 000 = 1×). */
  readonly multipliersBps: readonly string[]
  readonly ballsPerRound: string
  readonly operatorBondMist: string
  readonly challengerBondMist: string
  readonly challengeWindowMs: string
}

export interface Deployment {
  readonly network: 'testnet'
  readonly packageId: string
  readonly gameId: string
  readonly houseId: string
  readonly adminCapId: string
  readonly operatorCapId: string
  readonly house: HouseSettings
}

/** Public testnet full node (gRPC; works from Node and, via gRPC-web, the browser). */
export const TESTNET_GRPC_URL = 'https://fullnode.testnet.sui.io:443'
/** Explorer page of a transaction: `${TESTNET_EXPLORER_TX}/<digest>`. */
export const TESTNET_EXPLORER_TX = 'https://suiscan.xyz/testnet/tx'
/** Explorer page of an object: `${TESTNET_EXPLORER_OBJECT}/<id>`. */
export const TESTNET_EXPLORER_OBJECT = 'https://suiscan.xyz/testnet/object'
/** Explorer page of an address (balance, transactions): `${TESTNET_EXPLORER_ACCOUNT}/<address>`. */
export const TESTNET_EXPLORER_ACCOUNT = 'https://suiscan.xyz/testnet/account'

const OBJECT_ID = /^0x[0-9a-f]{64}$/
const DECIMAL = /^\d+$/

/** Checks a deployment read from JSON, so a hand-edited or stale file fails loudly. */
export function parseDeployment(value: unknown): Deployment {
  const d = value as Deployment
  const ids = [d?.packageId, d?.gameId, d?.houseId, d?.adminCapId, d?.operatorCapId]
  const amounts = [
    d?.house?.ballsPerRound,
    d?.house?.operatorBondMist,
    d?.house?.challengerBondMist,
    d?.house?.challengeWindowMs,
    ...(d?.house?.multipliersBps ?? []),
  ]
  if (d?.network !== 'testnet') throw new Error('deployment: network must be "testnet"')
  if (!ids.every((id) => typeof id === 'string' && OBJECT_ID.test(id))) {
    throw new Error('deployment: every id must be a 0x-prefixed 32-byte hex object id')
  }
  if (!d.house.multipliersBps?.length || !amounts.every((a) => typeof a === 'string' && DECIMAL.test(a))) {
    throw new Error('deployment: house settings must be decimal strings')
  }
  return d
}

/** Deployment names are file names: lowercase letters, digits and dashes (e.g. `kiana`). */
export const DEPLOYMENT_NAME = /^[a-z0-9-]+$/
