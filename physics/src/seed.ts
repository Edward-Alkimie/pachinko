/**
 * Seed derivation: turns one round seed into every ball's launch values.
 *
 *   bytes   = HMAC-SHA256(key = seed, msg = round_id ‖ ball_id ‖ event_id)
 *   msg     = round_id as u64 big-endian (8 bytes)
 *           ‖ ball_id  as u32 big-endian (4 bytes)
 *           ‖ event_id as u8             (1 byte)      → 13 bytes
 *   unit(k) = u32 big-endian from bytes[4k .. 4k+4] / 2^32   ∈ [0, 1)
 *
 * Launch (event 0x01): x  = launcher.x + (2·unit(0) − 1) · spreadX
 *                      vx = (2·unit(1) − 1) · maxVx,   y = launcher.y, vy = 0
 *
 * Any change here changes every round's result → bump the config version.
 */
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha2'
import type { MachineConfig } from './config'

export const SEED_BYTES = 32
export const EVENT_LAUNCH = 0x01

const U32_RANGE = 2 ** 32
const U64_MAX = 2n ** 64n - 1n
const MESSAGE_BYTES = 13

export interface Launch {
  readonly ballId: number
  /** Simulation tick at which the ball is created. */
  readonly tick: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
}

export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, message)
}

/** Parses a 32-byte seed written as 64 hex characters (optional 0x prefix). */
export function parseSeed(seedHex: string): Uint8Array {
  const clean = seedHex.startsWith('0x') ? seedHex.slice(2) : seedHex
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length !== SEED_BYTES * 2) {
    throw new Error(`seed must be ${SEED_BYTES * 2} hex characters (got "${seedHex}")`)
  }
  const bytes = new Uint8Array(SEED_BYTES)
  for (let i = 0; i < SEED_BYTES; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

export function seedToHex(seed: Uint8Array): string {
  return Array.from(seed, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Cryptographically random seed for local play (real rounds get theirs from Sui). */
export function randomSeedHex(): string {
  return seedToHex(globalThis.crypto.getRandomValues(new Uint8Array(SEED_BYTES)))
}

function assertUint(name: string, value: number, max: number) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${name} must be an integer 0..${max} (got ${value})`)
  }
}

export function encodeMessage(roundId: bigint, ballId: number, eventId: number): Uint8Array {
  if (roundId < 0n || roundId > U64_MAX) {
    throw new RangeError(`roundId must fit in u64 (got ${roundId})`)
  }
  assertUint('ballId', ballId, U32_RANGE - 1)
  assertUint('eventId', eventId, 0xff)
  const message = new Uint8Array(MESSAGE_BYTES)
  const view = new DataView(message.buffer)
  view.setBigUint64(0, roundId, false)
  view.setUint32(8, ballId, false)
  view.setUint8(12, eventId)
  return message
}

export function deriveBytes(
  seed: Uint8Array,
  roundId: bigint,
  ballId: number,
  eventId: number,
): Uint8Array {
  if (seed.length !== SEED_BYTES) {
    throw new Error(`seed must be ${SEED_BYTES} bytes (got ${seed.length})`)
  }
  return hmacSha256(seed, encodeMessage(roundId, ballId, eventId))
}

/** Big-endian u32 at `offset`, divided by 2^32 → exact double in [0, 1). */
export function bytesToUnit(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getUint32(offset, false) / U32_RANGE
}

export function deriveLaunch(
  seed: Uint8Array,
  roundId: bigint,
  ballId: number,
  config: MachineConfig,
): Launch {
  const bytes = deriveBytes(seed, roundId, ballId, EVENT_LAUNCH)
  const { launcher, timing } = config
  return {
    ballId,
    tick: ballId * timing.launchIntervalTicks,
    x: launcher.x + (2 * bytesToUnit(bytes, 0) - 1) * launcher.spreadX,
    y: launcher.y,
    vx: (2 * bytesToUnit(bytes, 4) - 1) * launcher.maxVx,
    vy: 0,
  }
}

export function deriveRoundLaunches(
  seed: Uint8Array,
  roundId: bigint,
  config: MachineConfig,
): readonly Launch[] {
  return Array.from({ length: config.timing.ballsPerRound }, (_, ballId) =>
    deriveLaunch(seed, roundId, ballId, config),
  )
}
