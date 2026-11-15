import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import {
  EVENT_LAUNCH,
  bytesToUnit,
  deriveBytes,
  deriveLaunch,
  deriveRoundLaunches,
  encodeMessage,
  hmacSha256,
  parseSeed,
  randomSeedHex,
  seedToHex,
} from '../src/seed'

const SEED_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const SEED = parseSeed(SEED_HEX)
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

describe('hmacSha256', () => {
  it('matches RFC 4231 test case 2', () => {
    const enc = new TextEncoder()
    const out = hmacSha256(enc.encode('Jefe'), enc.encode('what do ya want for nothing?'))
    expect(hex(out)).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })
})

describe('parseSeed / seedToHex', () => {
  it('round-trips a 32-byte hex seed', () => {
    expect(SEED).toHaveLength(32)
    expect(seedToHex(SEED)).toBe(SEED_HEX)
  })

  it('accepts upper case and an optional 0x prefix', () => {
    expect(seedToHex(parseSeed('0x' + SEED_HEX.toUpperCase()))).toBe(SEED_HEX)
  })

  it.each([
    ['too short', 'abcd'],
    ['too long', SEED_HEX + '00'],
    ['not hex', 'zz' + SEED_HEX.slice(2)],
  ])('rejects a seed that is %s', (_label, bad) => {
    expect(() => parseSeed(bad)).toThrow(/seed/i)
  })
})

describe('encodeMessage', () => {
  it('is round_id (u64 BE) ‖ ball_id (u32 BE) ‖ event_id (u8) = 13 bytes', () => {
    expect(hex(encodeMessage(1n, 0, EVENT_LAUNCH))).toBe('0000000000000001' + '00000000' + '01')
    expect(hex(encodeMessage(0x0102030405060708n, 0xa0b0c0d0, 0xff))).toBe(
      '0102030405060708' + 'a0b0c0d0' + 'ff',
    )
  })

  it.each([
    ['negative round id', () => encodeMessage(-1n, 0, EVENT_LAUNCH)],
    ['round id over u64', () => encodeMessage(2n ** 64n, 0, EVENT_LAUNCH)],
    ['fractional ball id', () => encodeMessage(1n, 1.5, EVENT_LAUNCH)],
    ['ball id over u32', () => encodeMessage(1n, 2 ** 32, EVENT_LAUNCH)],
    ['event id over u8', () => encodeMessage(1n, 0, 256)],
  ])('rejects %s', (_label, call) => {
    expect(call).toThrow()
  })
})

describe('deriveBytes', () => {
  it('equals HMAC-SHA256(seed, message) computed by Node crypto', () => {
    for (const [roundId, ballId] of [[1n, 0], [1n, 99], [42n, 7]] as const) {
      const expected = createHmac('sha256', SEED)
        .update(encodeMessage(roundId, ballId, EVENT_LAUNCH))
        .digest('hex')
      expect(hex(deriveBytes(SEED, roundId, ballId, EVENT_LAUNCH))).toBe(expected)
    }
  })
})

describe('bytesToUnit', () => {
  it('maps a big-endian u32 to [0, 1)', () => {
    expect(bytesToUnit(new Uint8Array([0, 0, 0, 0]), 0)).toBe(0)
    expect(bytesToUnit(new Uint8Array([0x80, 0, 0, 0]), 0)).toBe(0.5)
    expect(bytesToUnit(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 0)).toBeLessThan(1)
  })
})

describe('deriveLaunch', () => {
  const { launcher } = DEFAULT_CONFIG

  it('is deterministic', () => {
    expect(deriveLaunch(SEED, 1n, 5, DEFAULT_CONFIG)).toEqual(deriveLaunch(SEED, 1n, 5, DEFAULT_CONFIG))
  })

  it('matches the golden values (changing these breaks every old round)', () => {
    expect(deriveLaunch(SEED, 1n, 0, DEFAULT_CONFIG)).toMatchInlineSnapshot(`
      {
        "ballId": 0,
        "tick": 0,
        "vx": 15.677450075745583,
        "vy": 0,
        "x": 23.16981352865696,
        "y": 3,
      }
    `)
  })

  it('differs between balls, rounds and seeds', () => {
    const a = deriveLaunch(SEED, 1n, 0, DEFAULT_CONFIG)
    expect(deriveLaunch(SEED, 1n, 1, DEFAULT_CONFIG)).not.toEqual(a)
    expect(deriveLaunch(SEED, 2n, 0, DEFAULT_CONFIG)).not.toEqual(a)
    expect(deriveLaunch(parseSeed('ff'.repeat(32)), 1n, 0, DEFAULT_CONFIG)).not.toEqual(a)
  })

  it('stays inside the launcher limits and uses the whole range', () => {
    const launches = Array.from({ length: 2000 }, (_, i) => deriveLaunch(SEED, 7n, i, DEFAULT_CONFIG))
    const offsets = launches.map((l) => l.x - launcher.x)
    const speeds = launches.map((l) => l.vx)
    for (const l of launches) {
      expect(Math.abs(l.x - launcher.x)).toBeLessThanOrEqual(launcher.spreadX)
      expect(Math.abs(l.vx)).toBeLessThanOrEqual(launcher.maxVx)
      expect(l.y).toBe(launcher.y)
      expect(l.vy).toBe(0)
    }
    expect(Math.min(...offsets)).toBeLessThan(-0.95 * launcher.spreadX)
    expect(Math.max(...offsets)).toBeGreaterThan(0.95 * launcher.spreadX)
    expect(Math.min(...speeds)).toBeLessThan(-0.95 * launcher.maxVx)
    expect(Math.max(...speeds)).toBeGreaterThan(0.95 * launcher.maxVx)
  })
})

describe('deriveRoundLaunches', () => {
  it('creates ballsPerRound launches, one every launchIntervalTicks', () => {
    const { ballsPerRound, launchIntervalTicks } = DEFAULT_CONFIG.timing
    const launches = deriveRoundLaunches(SEED, 1n, DEFAULT_CONFIG)
    expect(launches).toHaveLength(ballsPerRound)
    launches.forEach((l, i) => {
      expect(l.ballId).toBe(i)
      expect(l.tick).toBe(i * launchIntervalTicks)
    })
  })
})

describe('randomSeedHex', () => {
  it('returns a fresh valid 32-byte seed each time', () => {
    const a = randomSeedHex()
    expect(parseSeed(a)).toHaveLength(32)
    expect(randomSeedHex()).not.toBe(a)
  })
})
