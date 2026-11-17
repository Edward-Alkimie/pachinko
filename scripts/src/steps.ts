/**
 * One function per on-chain step of a round, shared by the testnet scripts.
 * Each step is one transaction (deploy is three) and prints its digest. Contract: docs/SPEC.md §7.
 */
import { fileURLToPath } from 'node:url'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromHex, toHex } from '@mysten/sui/utils'
import {
  DEFAULT_CONFIG,
  OUTCOME_NONE,
  initPhysics,
  runRound,
  type RoundResult,
} from '@pachinko/physics'
import type { ScriptEnv } from './env'
import {
  buildPackage,
  createdObjectId,
  execute,
  publishedPackageId,
  readEvent,
  type Sui,
} from './sui'

const PACKAGE_PATH = fileURLToPath(new URL('../../contracts/pachinko', import.meta.url))
/** On-chain encoding of a ball that never landed (`-1` in physics). */
const OUTCOME_NONE_ONCHAIN = 0xffff
/** Extra wait after the deadline, for clock differences between this machine and the chain. */
const CLOCK_MARGIN_MS = 3_000

// BCS layouts of the events the scripts read (docs/SPEC.md §7).
const RoundCreated = bcs.struct('RoundCreated', {
  round: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  bet: bcs.u64(),
  config_version: bcs.string(),
})
const SeedDrawn = bcs.struct('SeedDrawn', {
  round: bcs.Address,
  round_id: bcs.u64(),
  seed: bcs.vector(bcs.u8()),
})
const ResultSubmitted = bcs.struct('ResultSubmitted', {
  round: bcs.Address,
  round_id: bcs.u64(),
  operator: bcs.Address,
  outcomes: bcs.vector(bcs.u16()),
  result_hash: bcs.vector(bcs.u8()),
  bond: bcs.u64(),
  deadline_ms: bcs.u64(),
})
const Resolved = bcs.struct('Resolved', {
  round: bcs.Address,
  round_id: bcs.u64(),
  operator_honest: bcs.bool(),
  winner: bcs.Address,
  award: bcs.u64(),
  result_hash: bcs.vector(bcs.u8()),
})
const Finalized = bcs.struct('Finalized', {
  round: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  payout: bcs.u64(),
  result_hash: bcs.vector(bcs.u8()),
})

/** Ids of one published package and its configured house. */
export interface Deployment {
  readonly packageId: string
  readonly adminCapId: string
  readonly gameId: string
  readonly houseId: string
  readonly operatorCapId: string
}

export interface OpenRound {
  readonly objectId: string
  readonly roundId: bigint
}

/** A round with its seed drawn and the true physics result computed off-chain. */
export interface SeededRound {
  readonly deployment: Deployment
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

/**
 * Publishes the package (`init` creates AdminCap + Game), gives this address an OperatorCap,
 * creates the House, then funds it (separate tx: the House is shared on creation).
 */
export async function deploy(sui: Sui, env: ScriptEnv): Promise<Deployment> {
  if (env.multipliersBps.length !== DEFAULT_CONFIG.pockets.length) {
    throw new Error(`PACHINKO_MULTIPLIERS_BPS needs ${DEFAULT_CONFIG.pockets.length} values`)
  }
  const publishTx = new Transaction()
  const upgradeCap = publishTx.publish(buildPackage(PACKAGE_PATH))
  publishTx.transferObjects([upgradeCap], sui.address)
  const published = await execute(sui, 'publish', publishTx)
  const packageId = publishedPackageId(published)
  const adminCapId = createdObjectId(published, `${packageId}::round::AdminCap`)

  const setup = new Transaction()
  setup.moveCall({
    target: `${packageId}::verification::issue_operator_cap`,
    arguments: [setup.object(adminCapId), setup.pure.address(sui.address)],
  })
  setup.moveCall({
    target: `${packageId}::verification::create_house`,
    arguments: [
      setup.object(adminCapId),
      setup.pure.vector('u64', env.multipliersBps),
      setup.pure.u64(DEFAULT_CONFIG.timing.ballsPerRound),
      setup.pure.u64(env.operatorBondMist),
      setup.pure.u64(env.challengerBondMist),
      setup.pure.u64(env.challengeWindowMs),
    ],
  })
  const created = await execute(sui, 'create house', setup)
  const houseId = createdObjectId(created, `${packageId}::verification::House`)

  const fund = new Transaction()
  const [funds] = fund.splitCoins(fund.gas, [env.houseFundsMist])
  fund.moveCall({
    target: `${packageId}::verification::fund_house`,
    arguments: [fund.object(houseId), funds],
  })
  await execute(sui, 'fund house', fund)

  return {
    packageId,
    adminCapId,
    gameId: createdObjectId(published, `${packageId}::round::Game`),
    houseId,
    operatorCapId: createdObjectId(created, `${packageId}::verification::OperatorCap`),
  }
}

/** Player locks the bet in a new Round. Stops if the round's config version isn't ours. */
export async function createRound(sui: Sui, env: ScriptEnv, d: Deployment): Promise<OpenRound> {
  const tx = new Transaction()
  const [bet] = tx.splitCoins(tx.gas, [env.betMist])
  tx.moveCall({
    target: `${d.packageId}::round::create_round`,
    arguments: [tx.object(d.gameId), bet],
  })
  const executed = await execute(sui, 'create round', tx)

  const created = readEvent(executed, `${d.packageId}::round::RoundCreated`, RoundCreated)
  if (created.config_version !== DEFAULT_CONFIG.version) {
    throw new Error(`round uses ${created.config_version}, local physics is ${DEFAULT_CONFIG.version}`)
  }
  return { objectId: created.round, roundId: BigInt(created.round_id) }
}

/** Draws the seed with sui::random in its own transaction (bet already locked). */
export async function drawSeed(sui: Sui, d: Deployment, round: OpenRound): Promise<Uint8Array> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::round::draw_seed`,
    arguments: [tx.object(round.objectId), tx.object.random()],
  })
  const executed = await execute(sui, 'draw seed', tx)
  return Uint8Array.from(readEvent(executed, `${d.packageId}::round::SeedDrawn`, SeedDrawn).seed)
}

/** deploy → create round → draw seed → runRound off-chain (the true result). */
export async function seededRound(sui: Sui, env: ScriptEnv): Promise<SeededRound> {
  const deployment = await deploy(sui, env)
  const round = await createRound(sui, env, deployment)
  const seed = await drawSeed(sui, deployment, round)

  await initPhysics()
  const result = runRound(seed, round.roundId, DEFAULT_CONFIG)
  console.log(`  physics: round ${round.roundId}, seed ${toHex(seed)}`)
  console.log(`  pockets ${pocketTally(result.outcomes)}, hash ${result.resultHash}`)
  return { deployment, round, seed, result }
}

/** Operator posts outcomes + hash with its bond; returns the challenge deadline (chain ms). */
export async function submitResult(
  sui: Sui,
  env: ScriptEnv,
  d: Deployment,
  round: OpenRound,
  outcomes: readonly number[],
  resultHash: string,
): Promise<number> {
  const tx = new Transaction()
  const [bond] = tx.splitCoins(tx.gas, [env.operatorBondMist])
  tx.moveCall({
    target: `${d.packageId}::verification::submit_result`,
    arguments: [
      tx.object(d.operatorCapId),
      tx.object(round.objectId),
      tx.object(d.houseId),
      tx.pure.vector('u16', toOnchainOutcomes(outcomes)),
      tx.pure.vector('u8', fromHex(resultHash)),
      bond,
      tx.object.clock(),
    ],
  })
  const executed = await execute(sui, 'submit result', tx)
  const submitted = readEvent(executed, `${d.packageId}::verification::ResultSubmitted`, ResultSubmitted)
  return Number(submitted.deadline_ms)
}

/** Disputes the submitted result with the challenger bond (must be before the deadline). */
export async function challenge(sui: Sui, env: ScriptEnv, d: Deployment, round: OpenRound) {
  const tx = new Transaction()
  const [bond] = tx.splitCoins(tx.gas, [env.challengerBondMist])
  tx.moveCall({
    target: `${d.packageId}::verification::challenge`,
    arguments: [tx.object(round.objectId), tx.object(d.houseId), bond, tx.object.clock()],
  })
  await execute(sui, 'challenge', tx)
}

/** Admin posts the correct outcomes; the contract decides the verdict and pays out. */
export async function resolveByAdmin(
  sui: Sui,
  d: Deployment,
  round: OpenRound,
  correctOutcomes: readonly number[],
): Promise<Resolution> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::verification::resolve_by_admin`,
    arguments: [
      tx.object(d.adminCapId),
      tx.object(round.objectId),
      tx.object(d.houseId),
      tx.pure.vector('u16', toOnchainOutcomes(correctOutcomes)),
    ],
  })
  const executed = await execute(sui, 'resolve (admin)', tx)
  const resolved = readEvent(executed, `${d.packageId}::verification::Resolved`, Resolved)
  const finalized = readEvent(executed, `${d.packageId}::verification::Finalized`, Finalized)
  return {
    operatorHonest: resolved.operator_honest,
    winner: resolved.winner,
    award: BigInt(resolved.award),
    payout: BigInt(finalized.payout),
  }
}

/** After the window: pays the player and returns the operator bond. Returns the payout (MIST). */
export async function finalize(sui: Sui, d: Deployment, round: OpenRound): Promise<bigint> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::verification::finalize`,
    arguments: [tx.object(round.objectId), tx.object(d.houseId), tx.object.clock()],
  })
  const executed = await execute(sui, 'finalize', tx)
  return BigInt(readEvent(executed, `${d.packageId}::verification::Finalized`, Finalized).payout)
}

/** Sleeps until the challenge window (chain time) has closed. */
export async function waitForDeadline(deadlineMs: number) {
  const waitMs = Math.max(0, deadlineMs - Date.now()) + CLOCK_MARGIN_MS
  console.log(`  waiting ${Math.ceil(waitMs / 1000)} s for the challenge window to close`)
  await new Promise((resolve) => setTimeout(resolve, waitMs))
}

function toOnchainOutcomes(outcomes: readonly number[]): number[] {
  return outcomes.map((o) => (o === OUTCOME_NONE ? OUTCOME_NONE_ONCHAIN : o))
}

function pocketTally(outcomes: readonly number[]): string {
  return DEFAULT_CONFIG.pockets
    .map((_, pocket) => `${pocket}:${outcomes.filter((o) => o === pocket).length}`)
    .join(' ')
}
