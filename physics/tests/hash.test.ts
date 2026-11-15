import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { encodeRoundResult, hashRoundResult } from '../src/hash'
import { parseSeed } from '../src/seed'

const SEED = parseSeed('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const base = { version: 'v', seed: SEED, roundId: 1n, outcomes: [0, 6, -1] }
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex')

describe('encodeRoundResult', () => {
  it('uses the documented byte layout', () => {
    const expected =
      Buffer.from('PACHINKO-RESULT-V1').toString('hex') + // domain tag
      '0001' + Buffer.from('v').toString('hex') + //       u16 version length + version
      hex(SEED) + //                                        32-byte seed
      '0000000000000001' + //                               u64 round id
      '00000003' + //                                       u32 ball count
      '0000' + '0006' + 'ffff' //                           i16 outcome per ball
    expect(hex(encodeRoundResult(base))).toBe(expected)
  })

  it('rejects outcomes that are not integers -1..32767', () => {
    expect(() => encodeRoundResult({ ...base, outcomes: [1.5] })).toThrow()
    expect(() => encodeRoundResult({ ...base, outcomes: [-2] })).toThrow()
  })
})

describe('hashRoundResult', () => {
  it('is SHA-256 of the encoding, as lowercase hex', () => {
    const expected = createHash('sha256').update(encodeRoundResult(base)).digest('hex')
    expect(hashRoundResult(base)).toBe(expected)
  })

  it('changes when any single outcome, the round, the seed or the version changes', () => {
    const h = hashRoundResult(base)
    expect(hashRoundResult({ ...base, outcomes: [0, 6, 0] })).not.toBe(h)
    expect(hashRoundResult({ ...base, roundId: 2n })).not.toBe(h)
    expect(hashRoundResult({ ...base, seed: parseSeed('ff'.repeat(32)) })).not.toBe(h)
    expect(hashRoundResult({ ...base, version: 'w' })).not.toBe(h)
  })
})
