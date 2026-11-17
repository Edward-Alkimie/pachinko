/**
 * One full pachinko round on Sui testnet:
 *
 *   publish → create + fund house → create round (bet locked) → draw seed (sui::random)
 *   → runRound off-chain → submit result (hash checked on-chain) → wait out the window → finalize
 *
 * Prints every transaction digest with an explorer link. One key plays admin, operator and player.
 * Usage: `npm run round:testnet` (needs SUI_PRIVATE_KEY in .env). Contract: docs/SPEC.md §7.
 */
import { fileURLToPath } from 'node:url'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromHex, toHex } from '@mysten/sui/utils'
import { DEFAULT_CONFIG, OUTCOME_NONE, initPhysics, runRound } from '@pachinko/physics'
import { loadEnv, type ScriptEnv } from './env'
import {
  buildPackage,
  connect,
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

// BCS layouts of the events this script reads (docs/SPEC.md §7).
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
const Finalized = bcs.struct('Finalized', {
  round: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  payout: bcs.u64(),
  result_hash: bcs.vector(bcs.u8()),
})

interface Deployment {
  readonly packageId: string
  readonly adminCapId: string
  readonly gameId: string
}

interface House {
  readonly houseId: string
  readonly operatorCapId: string
}

interface OpenRound {
  readonly objectId: string
  readonly roundId: bigint
}

/** Publishes the Move package; `init` creates the AdminCap and the shared Game. */
async function publish(sui: Sui): Promise<Deployment> {
  const tx = new Transaction()
  const upgradeCap = tx.publish(buildPackage(PACKAGE_PATH))
  tx.transferObjects([upgradeCap], sui.address)
  const executed = await execute(sui, 'publish', tx)

  const packageId = publishedPackageId(executed)
  return {
    packageId,
    adminCapId: createdObjectId(executed, `${packageId}::round::AdminCap`),
    gameId: createdObjectId(executed, `${packageId}::round::Game`),
  }
}

/** Gives this address an OperatorCap, creates the House, then funds it (separate tx: it is shared). */
async function setUpHouse(sui: Sui, env: ScriptEnv, d: Deployment): Promise<House> {
  const setup = new Transaction()
  setup.moveCall({
    target: `${d.packageId}::verification::issue_operator_cap`,
    arguments: [setup.object(d.adminCapId), setup.pure.address(sui.address)],
  })
  setup.moveCall({
    target: `${d.packageId}::verification::create_house`,
    arguments: [
      setup.object(d.adminCapId),
      setup.pure.vector('u64', env.multipliersBps),
      setup.pure.u64(DEFAULT_CONFIG.timing.ballsPerRound),
      setup.pure.u64(env.operatorBondMist),
      setup.pure.u64(env.challengerBondMist),
      setup.pure.u64(env.challengeWindowMs),
    ],
  })
  const executed = await execute(sui, 'create house', setup)
  const house = {
    houseId: createdObjectId(executed, `${d.packageId}::verification::House`),
    operatorCapId: createdObjectId(executed, `${d.packageId}::verification::OperatorCap`),
  }

  const fund = new Transaction()
  const [funds] = fund.splitCoins(fund.gas, [env.houseFundsMist])
  fund.moveCall({
    target: `${d.packageId}::verification::fund_house`,
    arguments: [fund.object(house.houseId), funds],
  })
  await execute(sui, 'fund house', fund)
  return house
}

/** Player locks the bet in a new Round. */
async function createRound(sui: Sui, env: ScriptEnv, d: Deployment): Promise<OpenRound> {
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
async function drawSeed(sui: Sui, d: Deployment, round: OpenRound): Promise<Uint8Array> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::round::draw_seed`,
    arguments: [tx.object(round.objectId), tx.object.random()],
  })
  const executed = await execute(sui, 'draw seed', tx)
  return Uint8Array.from(readEvent(executed, `${d.packageId}::round::SeedDrawn`, SeedDrawn).seed)
}

/** Operator posts outcomes + hash with its bond; returns the challenge deadline (chain ms). */
async function submitResult(
  sui: Sui,
  env: ScriptEnv,
  d: Deployment,
  house: House,
  round: OpenRound,
  outcomes: readonly number[],
  resultHash: string,
): Promise<number> {
  const tx = new Transaction()
  const [bond] = tx.splitCoins(tx.gas, [env.operatorBondMist])
  tx.moveCall({
    target: `${d.packageId}::verification::submit_result`,
    arguments: [
      tx.object(house.operatorCapId),
      tx.object(round.objectId),
      tx.object(house.houseId),
      tx.pure.vector('u16', outcomes.map((o) => (o === OUTCOME_NONE ? OUTCOME_NONE_ONCHAIN : o))),
      tx.pure.vector('u8', fromHex(resultHash)),
      bond,
      tx.object.clock(),
    ],
  })
  const executed = await execute(sui, 'submit result', tx)
  const submitted = readEvent(executed, `${d.packageId}::verification::ResultSubmitted`, ResultSubmitted)
  return Number(submitted.deadline_ms)
}

/** After the window: pays the player and returns the operator bond. Returns the payout (MIST). */
async function finalize(sui: Sui, d: Deployment, house: House, round: OpenRound): Promise<bigint> {
  const tx = new Transaction()
  tx.moveCall({
    target: `${d.packageId}::verification::finalize`,
    arguments: [tx.object(round.objectId), tx.object(house.houseId), tx.object.clock()],
  })
  const executed = await execute(sui, 'finalize', tx)
  return BigInt(readEvent(executed, `${d.packageId}::verification::Finalized`, Finalized).payout)
}

function pocketTally(outcomes: readonly number[]): string {
  return DEFAULT_CONFIG.pockets
    .map((_, pocket) => `${pocket}:${outcomes.filter((o) => o === pocket).length}`)
    .join(' ')
}

async function main() {
  const env = loadEnv()
  if (env.multipliersBps.length !== DEFAULT_CONFIG.pockets.length) {
    throw new Error(`PACHINKO_MULTIPLIERS_BPS needs ${DEFAULT_CONFIG.pockets.length} values`)
  }
  const sui = connect(env.grpcUrl, env.privateKey)
  console.log(`address          ${sui.address}\n`)

  const deployment = await publish(sui)
  const house = await setUpHouse(sui, env, deployment)
  const round = await createRound(sui, env, deployment)
  const seed = await drawSeed(sui, deployment, round)

  await initPhysics()
  const result = runRound(seed, round.roundId, DEFAULT_CONFIG)
  console.log(`  physics: round ${round.roundId}, seed ${toHex(seed)}`)
  console.log(`  pockets ${pocketTally(result.outcomes)}, hash ${result.resultHash}`)

  const deadlineMs = await submitResult(sui, env, deployment, house, round, result.outcomes, result.resultHash)
  const waitMs = Math.max(0, deadlineMs - Date.now()) + CLOCK_MARGIN_MS
  console.log(`  waiting ${Math.ceil(waitMs / 1000)} s for the challenge window to close`)
  await new Promise((resolve) => setTimeout(resolve, waitMs))

  const payout = await finalize(sui, deployment, house, round)
  console.log(`\npackage          ${deployment.packageId}`)
  console.log(`round object     ${round.objectId}`)
  console.log(`bet → payout     ${env.betMist} → ${payout} MIST`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
