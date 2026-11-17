/**
 * Replay CLI logic: argument parsing and the printed report.
 * cli.ts only wires these to process.argv / stdout.
 */
import { DEFAULT_CONFIG, initPhysics } from '@pachinko/physics'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseReplayArgs, replayReport } from '../src/replay'

const GOLDEN_SEED = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('')
const GOLDEN_HASH = '06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151'

beforeAll(() => initPhysics())

describe('parseReplayArgs', () => {
  it('takes a seed and defaults the round to 1', () => {
    expect(parseReplayArgs([GOLDEN_SEED])).toEqual({ ok: true, value: { seedHex: GOLDEN_SEED, roundId: 1n } })
  })

  it('accepts 0x seeds and an explicit round id', () => {
    expect(parseReplayArgs(['0x' + GOLDEN_SEED, '42'])).toEqual({
      ok: true,
      value: { seedHex: GOLDEN_SEED, roundId: 42n },
    })
  })

  it.each([
    ['no arguments', [], /Usage/],
    ['bad seed', ['xyz'], /seed/],
    ['bad round id', [GOLDEN_SEED, 'abc'], /roundId/],
    ['too many arguments', [GOLDEN_SEED, '1', 'extra'], /Usage/],
  ])('rejects %s', (_name, argv, message) => {
    const parsed = parseReplayArgs(argv)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toMatch(message)
  })
})

describe('replayReport', () => {
  it('prints the golden fixture: end tick, hash, outcomes and pocket tally', () => {
    const report = replayReport(GOLDEN_SEED, 1n, DEFAULT_CONFIG)
    expect(report).toContain(`config     ${DEFAULT_CONFIG.version}`)
    expect(report).toContain('endTick    1422')
    expect(report).toContain(`resultHash ${GOLDEN_HASH}`)
    expect(report).toMatch(/landed     100 \/ 100/)
    expect(report).toMatch(/^pocket 0 +\d+/m)
  })
})
