/**
 * Demo-only cheat mode for the operator (OPERATOR_CHEAT in .env), so a forged result can be caught
 * from the page or the terminal. The forged result still carries a matching hash, so the contract's
 * hash check accepts it: only a replay of the seed shows it is wrong (docs/CONTRACTS.md §1).
 *
 *   shortchange → every ball reported as never landed: the player is paid nothing
 *
 * Today the operator and the House are the same party (one key holds both caps), so the fraud
 * to demo is the House underpaying a player.
 */
import { OUTCOME_NONE } from '@pachinko/physics'

export const CHEATS = ['shortchange'] as const
export type Cheat = (typeof CHEATS)[number]

/** The cheat named in `value`, or `null` when unset (an honest operator). */
export function parseCheat(value: string | undefined): Cheat | null {
  const name = value?.trim()
  if (!name) return null
  if (!(CHEATS as readonly string[]).includes(name)) {
    throw new Error(`OPERATOR_CHEAT must be one of ${CHEATS.join(', ')} (got "${name}")`)
  }
  return name as Cheat
}

/** Outcomes the cheating operator submits instead of the honest ones. */
export function forgeOutcomes(cheat: Cheat, honest: readonly number[]): number[] {
  switch (cheat) {
    case 'shortchange':
      return honest.map(() => OUTCOME_NONE)
  }
}
