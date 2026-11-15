/**
 * Validation for what the player types into the replay form.
 * Each check returns null when the input is fine, or a message to show.
 */

const SEED_PATTERN = /^[0-9a-fA-F]{64}$/
const WHOLE_NUMBER = /^\d+$/
const U64_MAX = 2n ** 64n - 1n

/** Trims spaces and an optional 0x prefix, and lower-cases the seed. */
export function normalizeSeed(input: string): string {
  const trimmed = input.trim()
  const withoutPrefix = trimmed.startsWith('0x') ? trimmed.slice(2) : trimmed
  return withoutPrefix.toLowerCase()
}

export function checkSeed(input: string): string | null {
  return SEED_PATTERN.test(normalizeSeed(input))
    ? null
    : 'Seed must be 64 hex characters (0-9, a-f), optionally starting with 0x.'
}

export function checkRoundId(input: string): string | null {
  const trimmed = input.trim()
  if (!WHOLE_NUMBER.test(trimmed)) return 'Round ID must be a whole number (0 or more).'
  // Round IDs are encoded as u64 in the seed derivation and the result hash.
  if (BigInt(trimmed) > U64_MAX) return 'Round ID is too large (max 2^64 - 1).'
  return null
}
