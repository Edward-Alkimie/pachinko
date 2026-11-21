import { OUTCOME_NONE } from '@pachinko/physics'
import { describe, expect, it } from 'vitest'
import { forgeOutcomes, parseCheat } from '../src/operator/cheat'

describe('operator cheat mode', () => {
  it('is honest when OPERATOR_CHEAT is unset or blank', () => {
    expect(parseCheat(undefined)).toBeNull()
    expect(parseCheat('  ')).toBeNull()
  })

  it('rejects an unknown cheat', () => {
    expect(() => parseCheat('jackpot')).toThrow(/shortchange/)
  })

  it('shortchange reports every ball as never landed', () => {
    expect(forgeOutcomes(parseCheat('shortchange')!, [0, 3, 6, -1])).toEqual([
      OUTCOME_NONE,
      OUTCOME_NONE,
      OUTCOME_NONE,
      OUTCOME_NONE,
    ])
  })
})
