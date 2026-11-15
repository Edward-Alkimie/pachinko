import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import { hashRoundResult } from '../src/hash'
import { initPhysics, runRound, type RoundResult } from '../src/runRound'
import { parseSeed } from '../src/seed'

const SEED_A = parseSeed('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const SEED_B = parseSeed('ff'.repeat(32))
const { board, timing, pockets } = DEFAULT_CONFIG

let a: RoundResult
let aAgain: RoundResult
let b: RoundResult

beforeAll(async () => {
  await initPhysics()
  a = runRound(SEED_A, 1n, DEFAULT_CONFIG, { recordEvery: 2 })
  aAgain = runRound(SEED_A, 1n, DEFAULT_CONFIG, { recordEvery: 2 })
  b = runRound(SEED_B, 1n, DEFAULT_CONFIG)
})

describe('runRound', () => {
  it('returns one outcome per ball, each a pocket id or -1', () => {
    expect(a.outcomes).toHaveLength(timing.ballsPerRound)
    for (const o of a.outcomes) {
      expect(o === -1 || (Number.isInteger(o) && o >= 0 && o < pockets.length)).toBe(true)
    }
  })

  it('is deterministic: same seed and round give identical outcomes, hash and frames', () => {
    expect(aAgain.outcomes).toEqual(a.outcomes)
    expect(aAgain.landedAtTick).toEqual(a.landedAtTick)
    expect(aAgain.resultHash).toBe(a.resultHash)
    expect(aAgain.frames).toEqual(a.frames)
  })

  it('gives a different result for a different seed', () => {
    expect(b.outcomes).not.toEqual(a.outcomes)
    expect(b.resultHash).not.toBe(a.resultHash)
  })

  it('lands every ball before maxTicks with the default machine', () => {
    for (const r of [a, b]) {
      expect(r.outcomes).not.toContain(-1)
      expect(r.endTick).toBeLessThan(timing.maxTicks)
    }
  })

  it('never lands a ball before it is launched', () => {
    a.landedAtTick.forEach((t, ballId) => {
      expect(t).toBeGreaterThan(ballId * timing.launchIntervalTicks)
    })
  })

  it('reports the hash of its own outcomes', () => {
    expect(a.resultHash).toBe(
      hashRoundResult({ version: DEFAULT_CONFIG.version, seed: SEED_A, roundId: 1n, outcomes: a.outcomes }),
    )
  })

  it('keeps every recorded ball inside the board (nothing tunnels through a wall)', () => {
    expect(a.frames.length).toBeGreaterThan(0)
    for (const f of a.frames) {
      for (const ball of f.balls) {
        expect(ball.x).toBeGreaterThan(0)
        expect(ball.x).toBeLessThan(board.width)
        expect(ball.y).toBeGreaterThan(0)
        expect(ball.y).toBeLessThan(board.height)
      }
    }
  })

  it('records a frame every `recordEvery` ticks, and none when not asked', () => {
    expect(a.frames[1].tick - a.frames[0].tick).toBe(2)
    expect(b.frames).toEqual([])
  })

  it('times out stuck balls as -1 when maxTicks is too short', () => {
    const lastLaunch = (timing.ballsPerRound - 1) * timing.launchIntervalTicks
    const short = { ...DEFAULT_CONFIG, timing: { ...timing, maxTicks: lastLaunch + 1 } }
    const r = runRound(SEED_A, 1n, short)
    expect(r.outcomes).toContain(-1)
    expect(r.endTick).toBe(lastLaunch + 1)
  })

  it('matches the golden result (cross-platform fixture: must match in every browser)', () => {
    expect({ hash: a.resultHash, endTick: a.endTick }).toMatchInlineSnapshot(`
      {
        "endTick": 1422,
        "hash": "06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151",
      }
    `)
  })
})

describe('initPhysics', () => {
  it('can be called again safely', async () => {
    await expect(initPhysics()).resolves.toBeUndefined()
  })
})
