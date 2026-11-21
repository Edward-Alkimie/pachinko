import { RoundStatus, type DisputeView, type RoundView } from '@pachinko/chain'
import { describe, expect, it } from 'vitest'
import { verifierAction } from '../src/verifier/nextVote'

const VERSION = 'pachinko-v0.1.0'
const ME = '0xme'
const DEADLINE = 60_000

function round(status: RoundStatus, configVersion = VERSION): RoundView {
  return {
    objectId: '0x1',
    roundId: 1n,
    player: '0x2',
    configVersion,
    seed: new Uint8Array(32),
    betMist: 10n,
    status,
    submitDeadlineMs: 0,
  }
}

function dispute(committee: string[], voters: string[] = []): DisputeView {
  return { deadlineMs: DEADLINE, committee, votes: voters.map((voter) => ({ voter, resultHash: new Uint8Array() })) }
}

describe('verifier verifierAction', () => {
  it('draws the committee when nobody has', () => {
    expect(verifierAction(round(RoundStatus.Challenged), dispute([]), ME, 0, VERSION)).toEqual({ kind: 'select' })
  })

  it('votes once when drawn', () => {
    const drawn = dispute([ME, '0xa', '0xb'])
    expect(verifierAction(round(RoundStatus.Challenged), drawn, ME, 0, VERSION)).toEqual({ kind: 'vote' })
    const voted = dispute([ME, '0xa', '0xb'], [ME])
    expect(verifierAction(round(RoundStatus.Challenged), voted, ME, 0, VERSION).kind).toBe('done')
  })

  it('does nothing when not drawn, after the deadline, or once settled', () => {
    expect(verifierAction(round(RoundStatus.Challenged), dispute(['0xa', '0xb', '0xc']), ME, 0, VERSION).kind).toBe(
      'done',
    )
    expect(verifierAction(round(RoundStatus.Challenged), dispute([ME]), ME, DEADLINE, VERSION).kind).toBe('done')
    expect(verifierAction(round(RoundStatus.Finalized), null, ME, 0, VERSION).kind).toBe('done')
  })

  it('leaves a round of another physics version alone', () => {
    expect(verifierAction(round(RoundStatus.Challenged, 'pachinko-v9'), dispute([]), ME, 0, VERSION).kind).toBe('done')
  })
})
