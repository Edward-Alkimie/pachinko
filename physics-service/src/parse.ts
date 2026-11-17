/**
 * Input parsing shared by POST /verify and the replay CLI.
 *
 * Every parser returns a Parsed<T> instead of throwing, so callers can turn
 * the error into a 400 reply or a CLI message without try/catch.
 */

/** Either the parsed value, or a message saying what was wrong. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

export const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
export const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

const SEED_HEX = /^[0-9a-f]{64}$/
const DECIMAL = /^\d+$/
/** Round ids are u64 in the seed derivation and the result hash (docs/SPEC.md §2–3). */
const U64_MAX = 2n ** 64n - 1n

/** Seed as 64 lowercase hex chars; accepts an optional `0x` prefix and any case. */
export function parseSeedHex(input: unknown): Parsed<string> {
  if (typeof input !== 'string') return fail('seed must be a string of 64 hex characters')
  const trimmed = input.trim().toLowerCase()
  const hex = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  return SEED_HEX.test(hex) ? ok(hex) : fail('seed must be 64 hex characters (optionally 0x-prefixed)')
}

/**
 * Round id as a u64 bigint. Accepts a decimal string (preferred: JSON numbers
 * lose precision above 2^53) or a non-negative safe integer.
 */
export function parseRoundId(input: unknown): Parsed<bigint> {
  const problem = 'roundId must be a whole number from 0 to 2^64 - 1 (decimal string or integer)'
  let value: bigint
  if (typeof input === 'number' && Number.isSafeInteger(input)) value = BigInt(input)
  else if (typeof input === 'string' && DECIMAL.test(input.trim())) value = BigInt(input.trim())
  else return fail(problem)
  return value >= 0n && value <= U64_MAX ? ok(value) : fail(problem)
}
