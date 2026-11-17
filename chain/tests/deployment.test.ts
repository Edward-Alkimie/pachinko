import { describe, expect, it } from 'vitest'
import { parseDeployment, testnetDeployment } from '../src/deployment'

describe('parseDeployment', () => {
  it('accepts the committed testnet deployment', () => {
    expect(testnetDeployment().network).toBe('testnet')
  })

  it('rejects a malformed id or amount', () => {
    const d = testnetDeployment()
    expect(() => parseDeployment({ ...d, houseId: '0x12' })).toThrow(/object id/)
    expect(() =>
      parseDeployment({ ...d, house: { ...d.house, ballsPerRound: '1e2' } }),
    ).toThrow(/decimal/)
  })
})
