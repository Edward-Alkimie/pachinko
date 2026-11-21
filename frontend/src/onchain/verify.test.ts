import { RoundStatus, type RoundHistory } from '@pachinko/chain'
import { describe, expect, it } from 'vitest'
import { parseRoute, routeHash, verdictOf } from './verify'

const REPLAY = '07'.repeat(32)
const OTHER = 'ff'.repeat(32)
const bytes = (hex: string) => Array.from(Buffer.from(hex, 'hex'))

function history(paid: string | null, resolved?: { operator_honest: boolean }): RoundHistory {
  return {
    submitted: null,
    challenged: null,
    committee: null,
    votes: [],
    resolved: resolved ? ({ ...resolved } as RoundHistory['resolved']) : null,
    finalized: paid ? ({ result_hash: bytes(paid) } as RoundHistory['finalized']) : null,
    refunded: null,
  }
}

describe('verdictOf', () => {
  it('verified: paid from the replayed result, never challenged', () => {
    expect(verdictOf(RoundStatus.Finalized, history(REPLAY), REPLAY)).toBe('verified')
  })

  it('caught / upheld: a challenge was settled, and the paid result matches the replay', () => {
    expect(verdictOf(RoundStatus.Finalized, history(REPLAY, { operator_honest: false }), REPLAY)).toBe('caught')
    expect(verdictOf(RoundStatus.Finalized, history(REPLAY, { operator_honest: true }), REPLAY)).toBe('upheld')
  })

  it('unchallenged: paid from a result the replay does not give, and nobody challenged it', () => {
    expect(verdictOf(RoundStatus.Finalized, history(OTHER), REPLAY)).toBe('unchallenged')
  })

  it('paidMismatch: paid from a result the replay does not give, even after a challenge', () => {
    const challenged = { ...history(OTHER, { operator_honest: true }), challenged: {} as RoundHistory['challenged'] }
    expect(verdictOf(RoundStatus.Finalized, challenged, REPLAY)).toBe('paidMismatch')
  })

  it('refunded and in progress', () => {
    expect(verdictOf(RoundStatus.Refunded, history(null), REPLAY)).toBe('refunded')
    expect(verdictOf(RoundStatus.Challenged, history(null), REPLAY)).toBe('inProgress')
  })
})

describe('parseRoute / routeHash', () => {
  it('reads and writes the Verify route', () => {
    expect(parseRoute('#verify/12')).toEqual({ view: 'verify', round: 12n })
    expect(parseRoute('#verify')).toEqual({ view: 'verify', round: null })
    expect(parseRoute('')).toEqual({ view: 'play' })
    expect(parseRoute('#verify/abc')).toEqual({ view: 'play' })
    expect(routeHash({ view: 'verify', round: 12n })).toBe('#verify/12')
    expect(routeHash({ view: 'verify', round: null })).toBe('#verify')
    expect(routeHash({ view: 'play' })).toBe('')
  })
})
