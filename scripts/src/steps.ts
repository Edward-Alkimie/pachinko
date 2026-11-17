/**
 * One function per on-chain step of a round, shared by the testnet scripts. Transactions and
 * event layouts come from @pachinko/chain; each step signs, runs and prints its digest.
 */
import { fileURLToPath } from 'node:url'
import { Transaction } from '@mysten/sui/transactions'
import { toHex } from '@mysten/sui/utils'
import {
  Finalized,
  ResultSubmitted,
  Resolved,
  RoundCreated,
  SeedDrawn,
  challengeTx,
  createRoundTx,
  drawSeedTx,
  eventType,
  finalizeTx,
  fundHouseTx,
  resolveByAdminTx,
  setUpHouseTx,
  submitResultTx,
  type Deployment,
  type HouseSettings,
} from '@pachinko/chain'
import { DEFAULT_CONFIG, initPhysics, runRound, type RoundResult } from '@pachinko/physics'
import type { ScriptEnv } from './env'
import { buildPackage, createdObjectId, execute, publishedPackageId, readEvent, type Sui } from './sui'

const PACKAGE_PATH = fileURLToPath(new URL('../../contracts/pachinko', import.meta.url))
/** Extra wait after the deadline, for clock differences between this machine and the chain. */
const CLOCK_MARGIN_MS = 3_000

export interface OpenRound {
  readonly objectId: string
  readonly roundId: bigint
}

/** A round with its seed drawn and the true physics result computed off-chain. */
export interface SeededRound {
  readonly round: OpenRound
  readonly seed: Uint8Array
  readonly result: RoundResult
}

export interface Resolution {
  readonly operatorHonest: boolean
  readonly winner: string
  readonly award: bigint
  readonly payout: bigint
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

/** Draws the seed with sui::random in its own transaction (bet already locked). */
export async function drawSeed(sui: Sui, d: Deployment, round: OpenRound): Promise<Uint8Array> {
  const executed = await execute(sui, 'draw seed', drawSeedTx(d, round.objectId))
  return Uint8Array.from(readEvent(executed, eventType(d.packageId, 'SeedDrawn'), SeedDrawn).seed)
}

/** create round → draw seed → runRound off-chain (the true result). */
export async function seededRound(sui: Sui, env: ScriptEnv, deployment: Deployment): Promise<SeededRound> {
  const round = await createRound(sui, env, deployment)
  const seed = await drawSeed(sui, deployment, round)

  await initPhysics()
  const result = runRound(seed, round.roundId, DEFAULT_CONFIG)
  console.log(`  physics: round ${round.roundId}, seed ${toHex(seed)}`)
  console.log(`  pockets ${pocketTally(result.outcomes)}, hash ${result.resultHash}`)
  return { round, seed, result }
}

/** Operator posts outcomes + hash with its bond; returns the challenge deadline (chain ms). */
export async function submitResult(
  sui: Sui,
  d: Deployment,
  round: OpenRound,
  outcomes: readonly number[],
  resultHash: string,
): Promise<number> {
  const executed = await execute(sui, 'submit result', submitResultTx(d, round.objectId, outcomes, resultHash))
  const submitted = readEvent(executed, eventType(d.packageId, 'ResultSubmitted'), ResultSubmitted)
  return Number(submitted.deadline_ms)
}

/** Disputes the submitted result with the challenger bond (must be before the deadline). */
export async function challenge(sui: Sui, d: Deployment, round: OpenRound) {
  await execute(sui, 'challenge', challengeTx(d, round.objectId))
}

/** Admin posts the correct outcomes; the contract decides the verdict and pays out. */
export async function resolveByAdmin(
  sui: Sui,
  d: Deployment,
  round: OpenRound,
  correctOutcomes: readonly number[],
): Promise<Resolution> {
  const executed = await execute(sui, 'resolve (admin)', resolveByAdminTx(d, round.objectId, correctOutcomes))
  const resolved = readEvent(executed, eventType(d.packageId, 'Resolved'), Resolved)
  const finalized = readEvent(executed, eventType(d.packageId, 'Finalized'), Finalized)
  return {
    operatorHonest: resolved.operator_honest,
    winner: resolved.winner,
    award: BigInt(resolved.award),
    payout: BigInt(finalized.payout),
  }
}

/** After the window: pays the player and returns the operator bond. Returns the payout (MIST). */
export async function finalize(sui: Sui, d: Deployment, round: OpenRound): Promise<bigint> {
  const executed = await execute(sui, 'finalize', finalizeTx(d, round.objectId))
  return BigInt(readEvent(executed, eventType(d.packageId, 'Finalized'), Finalized).payout)
}

/** Sleeps until the challenge window (chain time) has closed. */
export async function waitForDeadline(deadlineMs: number) {
  const waitMs = Math.max(0, deadlineMs - Date.now()) + CLOCK_MARGIN_MS
  console.log(`  waiting ${Math.ceil(waitMs / 1000)} s for the challenge window to close`)
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}

function pocketTally(outcomes: readonly number[]): string {
  return DEFAULT_CONFIG.pockets
    .map((_, pocket) => `${pocket}:${outcomes.filter((o) => o === pocket).length}`)
    .join(' ')
}
