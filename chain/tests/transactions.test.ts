import { describe, expect, it } from 'vitest'
import type { Deployment } from '../src/deployment'
import { createRoundTx, drawSeedTx, finalizeTx, submitResultTx } from '../src/transactions'

const D: Deployment = {
  network: 'testnet',
  packageId: '0x1',
  gameId: '0x2',
  houseId: '0x3',
  adminCapId: '0x4',
  operatorCapId: '0x5',
  house: {
    multipliersBps: ['10000'],
    ballsPerRound: '100',
    operatorBondMist: '10',
    challengerBondMist: '10',
    challengeWindowMs: '30000',
  },
}

function moveCallTargets(tx: ReturnType<typeof createRoundTx>): string[] {
  return tx
    .getData()
    .commands.flatMap((c) => (c.MoveCall ? [`${c.MoveCall.package}::${c.MoveCall.module}::${c.MoveCall.function}`] : []))
}

describe('transaction builders', () => {
  it('call the matching contract functions', () => {
    const pkg = '0x0000000000000000000000000000000000000000000000000000000000000001'
    expect(moveCallTargets(createRoundTx(D, 5n))).toEqual([`${pkg}::round::create_round`])
    expect(moveCallTargets(drawSeedTx(D, '0x9'))).toEqual([`${pkg}::round::draw_seed`])
    expect(moveCallTargets(submitResultTx(D, '0x9', [-1, 0], 'ab'))).toEqual([
      `${pkg}::verification::submit_result`,
    ])
    expect(moveCallTargets(finalizeTx(D, '0x9'))).toEqual([`${pkg}::verification::finalize`])
  })
})
