/**
 * The on-chain steps the testnet scripts sign themselves: deploy (deploy:testnet), the player's
 * bet and challenge (bet:testnet), and funding + registering verifiers (verifiers:setup). The
 * operator's and verifiers' own steps live in physics-service.
 * Transactions and event layouts come from @pachinko/chain; each step prints its digest.
 */
import { fileURLToPath } from 'node:url'
import { Transaction } from '@mysten/sui/transactions'
import {
  RoundCreated,
  challengeTx,
  createRoundTx,
  eventType,
  fundHouseTx,
  joinPoolTx,
  readEvent,
  setUpHouseTx,
  type Deployment,
  type HouseSettings,
} from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import type { ScriptEnv } from './env'
import { buildPackage, createdObjectId, execute, publishedPackageId, type Sui } from './sui'

const PACKAGE_PATH = fileURLToPath(new URL('../../contracts/pachinko', import.meta.url))

export interface OpenRound {
  readonly objectId: string
  readonly roundId: bigint
}

/** House settings from `.env`, for this machine's physics config. */
function houseSettings(env: ScriptEnv): HouseSettings {
  if (env.multipliersBps.length !== DEFAULT_CONFIG.pockets.length) {
    throw new Error(`PACHINKO_MULTIPLIERS_BPS needs ${DEFAULT_CONFIG.pockets.length} values`)
  }
  return {
    multipliersBps: env.multipliersBps.map(String),
    ballsPerRound: String(DEFAULT_CONFIG.timing.ballsPerRound),
    operatorBondMist: String(env.operatorBondMist),
    challengerBondMist: String(env.challengerBondMist),
    challengeWindowMs: String(env.challengeWindowMs),
    verifierStakeMist: String(env.verifierStakeMist),
    voteWindowMs: String(env.voteWindowMs),
  }
}

/**
 * Publishes the package (`init` creates AdminCap + Game), gives this address an OperatorCap,
 * creates the House, then funds it (separate tx: the House is shared on creation).
 */
export async function deploy(sui: Sui, env: ScriptEnv): Promise<Deployment> {
  const house = houseSettings(env)
  const publishTx = new Transaction()
  const upgradeCap = publishTx.publish(buildPackage(PACKAGE_PATH))
  publishTx.transferObjects([upgradeCap], sui.address)
  const published = await execute(sui, 'publish', publishTx)
  const packageId = publishedPackageId(published)
  const adminCapId = createdObjectId(published, `${packageId}::round::AdminCap`)

  const created = await execute(sui, 'create house', setUpHouseTx(packageId, adminCapId, sui.address, house))
  const houseId = createdObjectId(created, `${packageId}::verification::House`)
  await execute(sui, 'fund house', fundHouseTx(packageId, houseId, env.houseFundsMist))

  return {
    network: 'testnet',
    packageId,
    gameId: createdObjectId(published, `${packageId}::round::Game`),
    houseId,
    adminCapId,
    operatorCapId: createdObjectId(created, `${packageId}::verification::OperatorCap`),
    house,
  }
}

/** Player locks the bet in a new Round. Stops if the round's config version isn't ours. */
export async function createRound(sui: Sui, env: ScriptEnv, d: Deployment): Promise<OpenRound> {
  const executed = await execute(sui, 'create round', createRoundTx(d, env.betMist))
  const created = readEvent(executed, eventType(d.packageId, 'RoundCreated'), RoundCreated)
  if (created.config_version !== DEFAULT_CONFIG.version) {
    throw new Error(`round uses ${created.config_version}, local physics is ${DEFAULT_CONFIG.version}`)
  }
  return { objectId: created.round, roundId: BigInt(created.round_id) }
}

/** Disputes the submitted result with the challenger bond (must be before the deadline). */
export async function challenge(sui: Sui, d: Deployment, round: OpenRound) {
  await execute(sui, 'challenge', challengeTx(d, round.objectId))
}

/** Sends `amountMist` from `sui` to `recipient` (e.g. a verifier's stake and gas). */
export async function fund(sui: Sui, recipient: string, amountMist: bigint) {
  const tx = new Transaction()
  const [coin] = tx.splitCoins(tx.gas, [amountMist])
  tx.transferObjects([coin], recipient)
  await execute(sui, 'fund', tx)
}

/** `verifier` joins the House's pool with the deployment's exact stake. */
export async function joinPool(verifier: Sui, d: Deployment) {
  await execute(verifier, 'join pool', joinPoolTx(d))
}
