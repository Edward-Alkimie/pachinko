/**
 * verify.ts: request validation and the per-ball outcome check.
 * Uses the golden fixture from docs/SPEC.md §3 (seed 000102…1f, round 1).
 */
import { DEFAULT_CONFIG, initPhysics, parseSeed, runRound } from '@pachinko/physics'
import { beforeAll, describe, expect, it } from 'vitest'
import { compareOutcomes, parseVerifyRequest, verifyRound } from '../src/verify'

const GOLDEN_SEED = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('')
const GOLDEN_HASH = '06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151'
const POCKETS = DEFAULT_CONFIG.pockets.length
const BALLS = DEFAULT_CONFIG.timing.ballsPerRound

let goldenOutcomes: number[] = []

beforeAll(async () => {
  await initPhysics()
  goldenOutcomes = [...runRound(parseSeed(GOLDEN_SEED), 1n, DEFAULT_CONFIG).outcomes]
})

/** A valid request body; override single fields per test. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    seed: GOLDEN_SEED,
    roundId: '1',
    configVersion: DEFAULT_CONFIG.version,
    outcomes: goldenOutcomes,
    ...overrides,
  }
}

describe('parseVerifyRequest', () => {
  it('accepts a valid request and normalises seed + roundId', () => {
    const parsed = parseVerifyRequest(body({ seed: '0x' + GOLDEN_SEED.toUpperCase() }), DEFAULT_CONFIG)
    expect(parsed).toEqual({
      ok: true,
      value: { seedHex: GOLDEN_SEED, roundId: 1n, configVersion: DEFAULT_CONFIG.version, outcomes: goldenOutcomes },
    })
  })

  it('accepts roundId as a safe integer number', () => {
    const parsed = parseVerifyRequest(body({ roundId: 7 }), DEFAULT_CONFIG)
    expect(parsed.ok && parsed.value.roundId).toBe(7n)
  })

  it.each([
    ['not an object', null, /JSON object/],
    ['bad seed', body({ seed: 'xyz' }), /seed/],
    ['negative roundId', body({ roundId: '-1' }), /roundId/],
    ['roundId too large', body({ roundId: (2n ** 64n).toString() }), /roundId/],
    ['fractional roundId', body({ roundId: 1.5 }), /roundId/],
    ['missing configVersion', body({ configVersion: undefined }), /configVersion/],
    ['outcomes not an array', body({ outcomes: 'abc' }), /outcomes/],
    ['wrong number of outcomes', body({ outcomes: [0, 1] }), new RegExp(`${BALLS}`)],
    ['outcome out of range', body({ outcomes: Array(BALLS).fill(POCKETS) }), /outcomes\[0\]/],
    ['non-integer outcome', body({ outcomes: Array(BALLS).fill(0.5) }), /outcomes\[0\]/],
  ])('rejects %s', (_name, input, message) => {
    const parsed = parseVerifyRequest(input, DEFAULT_CONFIG)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(message)
  })

  it('accepts -1 (ball never landed) as an outcome', () => {
    const outcomes = Array(BALLS).fill(-1)
    expect(parseVerifyRequest(body({ outcomes }), DEFAULT_CONFIG).ok).toBe(true)
  })
})

describe('compareOutcomes', () => {
  it('lists every ball whose outcome differs', () => {
    expect(compareOutcomes([0, 1, 2, 3], [0, 5, 2, -1])).toEqual([
      { ballId: 1, client: 5, server: 1 },
      { ballId: 3, client: -1, server: 3 },
    ])
  })

  it('returns [] when all match', () => {
    expect(compareOutcomes([1, 2], [1, 2])).toEqual([])
  })
})

describe('verifyRound', () => {
  it('passes honest outcomes and returns the golden hash', () => {
    const result = verifyRound({ seedHex: GOLDEN_SEED, roundId: 1n, configVersion: DEFAULT_CONFIG.version, outcomes: goldenOutcomes }, DEFAULT_CONFIG)
    expect(result).toMatchObject({ ok: true, mismatches: [], resultHash: GOLDEN_HASH, roundId: '1' })
    expect(result.serverOutcomes).toEqual(goldenOutcomes)
  })

  it('catches a forged jackpot on exactly the edited balls', () => {
    const forged = [...goldenOutcomes]
    const jackpot = goldenOutcomes[0] === 3 ? 2 : 3
    forged[0] = jackpot
    forged[42] = goldenOutcomes[42] === 3 ? 2 : 3

    const result = verifyRound({ seedHex: GOLDEN_SEED, roundId: 1n, configVersion: DEFAULT_CONFIG.version, outcomes: forged }, DEFAULT_CONFIG)

    expect(result.ok).toBe(false)
    expect(result.mismatches.map((m) => m.ballId)).toEqual([0, 42])
    expect(result.mismatches[0]).toEqual({ ballId: 0, client: jackpot, server: goldenOutcomes[0] })
    expect(result.resultHash).toBe(GOLDEN_HASH) // server's result, not the client's
  })
})
