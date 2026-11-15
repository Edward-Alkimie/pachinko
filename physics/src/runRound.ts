/**
 * runRound: simulates one full round and returns where every ball landed.
 *
 * Tick loop (fixed order, so every platform does exactly the same thing):
 *   1. spawn balls whose launch tick == current tick (ball-id order)
 *   2. world.step()  (dt = 1 / tickHz)
 *   3. in ball-id order: a ball fully below the divider tops has landed →
 *      pocket chosen by x, ball removed from the world
 * Ends when every ball has landed, or at maxTicks (remaining balls → -1).
 */
import RAPIER from '@dimforge/rapier2d-deterministic-compat'
import { buildPins, type MachineConfig } from './config'
import { buildDividers, buildWalls } from './geometry'
import { hashRoundResult } from './hash'
import { deriveRoundLaunches, type Launch } from './seed'

export const OUTCOME_NONE = -1

export interface BallPosition {
  readonly id: number
  readonly x: number
  readonly y: number
}

export interface Frame {
  readonly tick: number
  readonly balls: readonly BallPosition[]
}

export interface RoundOptions {
  /** Record ball positions every N ticks (0 = no frames). E.g. 2 → 60 fps at 120 Hz. */
  readonly recordEvery?: number
}

export interface RoundResult {
  /** Pocket id per ball in ball-id order; -1 = did not land before maxTicks. */
  readonly outcomes: readonly number[]
  /** Tick at which each ball landed; -1 if it never did. */
  readonly landedAtTick: readonly number[]
  /** Last simulated tick. */
  readonly endTick: number
  readonly resultHash: string
  readonly frames: readonly Frame[]
}

let initialised: Promise<void> | null = null

/** Loads Rapier's WASM. Call (and await) once before runRound; safe to call again. */
export function initPhysics(): Promise<void> {
  initialised ??= RAPIER.init()
  return initialised
}

type World = InstanceType<typeof RAPIER.World>
type Body = ReturnType<World['createRigidBody']>

function buildWorld(config: MachineConfig): World {
  const world = new RAPIER.World({ x: config.gravity.x, y: config.gravity.y })
  world.timestep = 1 / config.timing.tickHz

  for (const box of [...buildWalls(config), ...buildDividers(config)]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(box.halfWidth, box.halfHeight)
        .setTranslation(box.x, box.y)
        .setRestitution(config.pin.restitution)
        .setFriction(config.pin.friction),
    )
  }
  for (const p of buildPins(config)) {
    world.createCollider(
      RAPIER.ColliderDesc.ball(config.pin.radius)
        .setTranslation(p.x, p.y)
        .setRestitution(config.pin.restitution)
        .setFriction(config.pin.friction),
    )
  }
  return world
}

function spawnBall(world: World, launch: Launch, config: MachineConfig): Body {
  const { ball } = config
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(launch.x, launch.y)
      .setLinvel(launch.vx, launch.vy)
      .setCcdEnabled(true),
  )
  world.createCollider(
    RAPIER.ColliderDesc.ball(ball.radius)
      .setDensity(ball.density)
      .setRestitution(ball.restitution)
      .setFriction(ball.friction),
    body,
  )
  return body
}

function pocketAt(x: number, config: MachineConfig): number {
  const pocket = config.pockets.find((p) => x >= p.xMin && x < p.xMax)
  // x == board.width (right edge) belongs to the last pocket.
  return pocket ? pocket.id : config.pockets[config.pockets.length - 1].id
}

function assertRunnable(seed: Uint8Array, config: MachineConfig, recordEvery: number) {
  if (initialised === null) throw new Error('call `await initPhysics()` before runRound')
  if (!Number.isInteger(recordEvery) || recordEvery < 0) {
    throw new RangeError(`recordEvery must be a non-negative integer (got ${recordEvery})`)
  }
  if (seed.length !== 32) throw new Error('seed must be 32 bytes')
  if (config.timing.ballsPerRound < 1) throw new RangeError('ballsPerRound must be >= 1')
}

export function runRound(
  seed: Uint8Array,
  roundId: bigint,
  config: MachineConfig,
  options: RoundOptions = {},
): RoundResult {
  const recordEvery = options.recordEvery ?? 0
  assertRunnable(seed, config, recordEvery)

  const launches = deriveRoundLaunches(seed, roundId, config)
  const count = launches.length
  const landLineY = config.board.height - config.pocketDepth + config.ball.radius
  const outcomes: number[] = new Array(count).fill(OUTCOME_NONE)
  const landedAtTick: number[] = new Array(count).fill(OUTCOME_NONE)
  const bodies: (Body | null)[] = new Array(count).fill(null)
  const frames: Frame[] = []

  const world = buildWorld(config)
  let nextLaunch = 0
  let landed = 0
  let tick = 0
  try {
    while (landed < count && tick < config.timing.maxTicks) {
      while (nextLaunch < count && launches[nextLaunch].tick === tick) {
        bodies[nextLaunch] = spawnBall(world, launches[nextLaunch], config)
        nextLaunch++
      }
      world.step()
      tick++

      for (let id = 0; id < count; id++) {
        const body = bodies[id]
        if (body === null) continue
        const pos = body.translation()
        if (pos.y > landLineY) {
          outcomes[id] = pocketAt(pos.x, config)
          landedAtTick[id] = tick
          world.removeRigidBody(body)
          bodies[id] = null
          landed++
        }
      }

      if (recordEvery > 0 && tick % recordEvery === 0) {
        const balls: BallPosition[] = []
        bodies.forEach((body, id) => {
          if (body !== null) {
            const { x, y } = body.translation()
            balls.push({ id, x, y })
          }
        })
        frames.push({ tick, balls })
      }
    }
  } finally {
    world.free()
  }

  return {
    outcomes,
    landedAtTick,
    endTick: tick,
    resultHash: hashRoundResult({ version: config.version, seed, roundId, outcomes }),
    frames,
  }
}
