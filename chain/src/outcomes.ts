/**
 * Outcome encoding between physics and the contract (docs/SPEC.md §7.2):
 * physics uses `-1` for a ball that never landed; on-chain outcomes are `u16` with `0xFFFF`.
 */

/** Physics value for a ball that never landed (`OUTCOME_NONE` in @pachinko/physics). */
const PHYSICS_NONE = -1
/** The same, on-chain. Same bytes as i16 `-1` in the result hash. */
export const ONCHAIN_OUTCOME_NONE = 0xffff

export function toOnchainOutcomes(outcomes: readonly number[]): number[] {
  return outcomes.map((o) => (o === PHYSICS_NONE ? ONCHAIN_OUTCOME_NONE : o))
}

export function fromOnchainOutcomes(outcomes: readonly number[]): number[] {
  return outcomes.map((o) => (o === ONCHAIN_OUTCOME_NONE ? PHYSICS_NONE : o))
}
