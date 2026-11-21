import { RoundStatus, type RoundView } from '@pachinko/chain'
import { describe, expect, it } from 'vitest'
import { CLOCK_MARGIN_MS, arbiterAction, nextAction } from '../src/operator/nextAction'

const VERSION = 'pachinko-v0.1.0'

function round(status: RoundStatus, configVersion = VERSION): RoundView {
  return {
    objectId: '0x1',
    roundId: 1n,
    player: '0x2',
    configVersion,
    seed: status === RoundStatus.BetLocked ? null : new Uint8Array(32),
    betMist: 10n,
    status,
    submitDeadlineMs: 0,
  }
}

describe('operator nextAction', () => {
  it('draws the seed of a new round', () => {
    expect(nextAction(round(RoundStatus.BetLocked), null, 0, VERSION)).toEqual({ kind: 'drawSeed' })
  })

  it('submits a seeded round that uses its physics version', () => {
    expect(nextAction(round(RoundStatus.Seeded), null, 0, VERSION)).toEqual({ kind: 'submit' })
  })

  it('leaves a seeded round of another physics version alone', () => {
    const action = nextAction(round(RoundStatus.Seeded, 'pachinko-v9'), null, 0, VERSION)
    expect(action.kind).toBe('drop')
  })

  it('waits for the window (plus clock margin), then finalizes', () => {
    const deadline = 10_000
    expect(nextAction(round(RoundStatus.Submitted), deadline, deadline, VERSION)).toEqual({
      kind: 'wait',
      untilMs: deadline + CLOCK_MARGIN_MS,
    })
    expect(nextAction(round(RoundStatus.Submitted), deadline, deadline + CLOCK_MARGIN_MS, VERSION)).toEqual({
      kind: 'finalize',
    })
  })

  it('drops challenged, finalized and refunded rounds', () => {
    expect(nextAction(round(RoundStatus.Challenged), null, 0, VERSION).kind).toBe('drop')
    expect(nextAction(round(RoundStatus.Finalized), null, 0, VERSION).kind).toBe('drop')
    expect(nextAction(round(RoundStatus.Refunded), null, 0, VERSION).kind).toBe('drop')
  })
})

describe('arbiter arbiterAction', () => {
  it('waits for the vote deadline (plus clock margin), then resolves as the fallback', () => {
    const deadline = 60_000
    expect(arbiterAction(round(RoundStatus.Challenged), deadline, deadline, VERSION)).toEqual({
      kind: 'wait',
      untilMs: deadline + CLOCK_MARGIN_MS,
    })
    expect(arbiterAction(round(RoundStatus.Challenged), deadline, deadline + CLOCK_MARGIN_MS, VERSION)).toEqual({
      kind: 'resolve',
    })
  })

  it('leaves a challenged round of another physics version alone', () => {
    expect(arbiterAction(round(RoundStatus.Challenged, 'pachinko-v9'), 0, 0, VERSION).kind).toBe('drop')
  })

  it('drops a round the committee already settled', () => {
    expect(arbiterAction(round(RoundStatus.Finalized), null, 0, VERSION).kind).toBe('drop')
  })
})
