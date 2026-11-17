import { afterEach, describe, expect, it } from 'vitest'
import { parseDeployment } from '../src/deployment'
import { deploymentName, deploymentNames, loadDeployment } from '../src/node'

describe('named deployments', () => {
  const saved = process.env.PACHINKO_DEPLOYMENT
  afterEach(() => {
    process.env.PACHINKO_DEPLOYMENT = saved
  })

  it('loads every committed deployment file', () => {
    expect(deploymentNames()).toContain('kiana')
    for (const name of deploymentNames()) expect(loadDeployment(name).network).toBe('testnet')
  })

  it('needs PACHINKO_DEPLOYMENT to be a known-safe name', () => {
    delete process.env.PACHINKO_DEPLOYMENT
    expect(() => deploymentName()).toThrow(/set PACHINKO_DEPLOYMENT/)
    process.env.PACHINKO_DEPLOYMENT = '../secrets'
    expect(() => deploymentName()).toThrow(/lowercase/)
  })

  it('explains how to create a missing deployment', () => {
    expect(() => loadDeployment('nobody')).toThrow(/deploy:testnet/)
  })
})

describe('parseDeployment', () => {
  it('rejects a malformed id or amount', () => {
    const d = loadDeployment('kiana')
    expect(() => parseDeployment({ ...d, houseId: '0x12' })).toThrow(/object id/)
    expect(() => parseDeployment({ ...d, house: { ...d.house, ballsPerRound: '1e2' } })).toThrow(/decimal/)
  })
})
