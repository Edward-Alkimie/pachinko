/**
 * Result hash: SHA-256 over a fixed byte encoding of a round's result.
 *
 *   "PACHINKO-RESULT-V1" (ASCII)
 *   ‖ u16 BE  length of version  ‖ version (UTF-8)
 *   ‖ seed (32 bytes)
 *   ‖ u64 BE  round id
 *   ‖ u32 BE  number of balls
 *   ‖ i16 BE  outcome of each ball, in ball-id order (-1 = stuck / timed out)
 *
 * Binding version, seed and round id means a result can't be replayed onto another round.
 */
import { sha256 } from '@noble/hashes/sha2'
import { SEED_BYTES } from './seed'

const DOMAIN_TAG = 'PACHINKO-RESULT-V1'
const MAX_OUTCOME = 0x7fff

export interface RoundResultInput {
  readonly version: string
  readonly seed: Uint8Array
  readonly roundId: bigint
  readonly outcomes: readonly number[]
}

export function encodeRoundResult({ version, seed, roundId, outcomes }: RoundResultInput): Uint8Array {
  const enc = new TextEncoder()
  const tag = enc.encode(DOMAIN_TAG)
  const ver = enc.encode(version)
  if (ver.length > 0xffff) throw new RangeError('version is too long')
  if (seed.length !== SEED_BYTES) throw new Error(`seed must be ${SEED_BYTES} bytes`)
  if (roundId < 0n || roundId >= 2n ** 64n) throw new RangeError('roundId must fit in u64')

  const out = new Uint8Array(tag.length + 2 + ver.length + SEED_BYTES + 8 + 4 + 2 * outcomes.length)
  const view = new DataView(out.buffer)
  let at = 0
  out.set(tag, at); at += tag.length
  view.setUint16(at, ver.length, false); at += 2
  out.set(ver, at); at += ver.length
  out.set(seed, at); at += SEED_BYTES
  view.setBigUint64(at, roundId, false); at += 8
  view.setUint32(at, outcomes.length, false); at += 4
  for (const o of outcomes) {
    if (!Number.isInteger(o) || o < -1 || o > MAX_OUTCOME) {
      throw new RangeError(`outcome must be an integer -1..${MAX_OUTCOME} (got ${o})`)
    }
    view.setInt16(at, o, false); at += 2
  }
  return out
}

export function hashRoundResult(input: RoundResultInput): string {
  return Array.from(sha256(encodeRoundResult(input)), (b) => b.toString(16).padStart(2, '0')).join('')
}
