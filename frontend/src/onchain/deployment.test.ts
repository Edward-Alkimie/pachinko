import { describe, expect, it } from 'vitest'
import kiana from '../../../chain/src/deployments/kiana.json'
import { selectDeployment } from './deployment'

const FILES = { '../../../chain/src/deployments/kiana.json': kiana }

describe('selectDeployment', () => {
  it('picks the named deployment file', () => {
    const setup = selectDeployment(FILES, 'kiana')
    expect(setup.enabled && setup.deployment.packageId).toBe(kiana.packageId)
  })

  it('turns on-chain play off with a reason when unset, invalid or unknown', () => {
    expect(selectDeployment(FILES, undefined)).toMatchObject({ enabled: false, reason: /VITE_PACHINKO_DEPLOYMENT/ })
    expect(selectDeployment(FILES, '../x')).toMatchObject({ enabled: false, reason: /Invalid/ })
    expect(selectDeployment(FILES, 'kevin')).toMatchObject({ enabled: false, reason: /deploy:testnet/ })
  })
})
