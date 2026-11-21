import { describe, expect, it } from 'vitest'
import { settlement } from './settlement'

const BET = 10n
const BOND = 10n
const ME = '0xme'

describe('settlement', () => {
  it('is empty until the round is final', () => {
    const state = { phase: 'verifying' as const, payoutMist: null, challengeDigest: null, resolution: null }
    expect(settlement(state, ME, BET, BOND)).toBeNull()
  })

  it('unchallenged: bet out, payout in', () => {
    const state = { phase: 'final' as const, payoutMist: 0n, challengeDigest: null, resolution: null }
    expect(settlement(state, ME, BET, BOND)).toEqual({
      lines: [
        { label: 'Bet', mist: -10n },
        { label: 'Payout', mist: 0n },
      ],
      netMist: -10n,
    })
  })

  it('won challenge: bond out, true payout in, both bonds in', () => {
    const state = {
      phase: 'final' as const,
      payoutMist: 10n,
      challengeDigest: 'TX',
      resolution: { operatorHonest: false, winner: ME, awardMist: 20n },
    }
    expect(settlement(state, ME, BET, BOND)?.netMist).toBe(10n)
    expect(settlement(state, ME, BET, BOND)?.lines.map((l) => l.label)).toEqual([
      'Bet',
      'Challenge bond',
      'Payout',
      'Bonds won',
    ])
  })

  it('lost challenge: the bond is gone', () => {
    const state = {
      phase: 'final' as const,
      payoutMist: 10n,
      challengeDigest: 'TX',
      resolution: { operatorHonest: true, winner: '0xoperator', awardMist: 20n },
    }
    expect(settlement(state, ME, BET, BOND)?.netMist).toBe(-10n)
  })
})
