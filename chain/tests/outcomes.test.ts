import { describe, expect, it } from 'vitest'
import { ONCHAIN_OUTCOME_NONE, fromOnchainOutcomes, toOnchainOutcomes } from '../src/outcomes'

describe('outcome encoding', () => {
  it('maps -1 to 0xFFFF and back, leaving pockets unchanged', () => {
    const physics = [-1, 0, 6, -1, 3]
    const onchain = toOnchainOutcomes(physics)
    expect(onchain).toEqual([ONCHAIN_OUTCOME_NONE, 0, 6, ONCHAIN_OUTCOME_NONE, 3])
    expect(fromOnchainOutcomes(onchain)).toEqual(physics)
  })
})
