import { describe, expect, it } from 'vitest'
import { checkRoundId, checkSeed } from './validation'

describe('checkSeed', () => {
  it('accepts 64 hex characters, with or without 0x and spaces around', () => {
    expect(checkSeed('ab'.repeat(32))).toBeNull()
    expect(checkSeed('  0x' + 'AB'.repeat(32) + ' ')).toBeNull()
  })

  it('explains what is wrong otherwise', () => {
    expect(checkSeed('')).toMatch(/64 hex/)
    expect(checkSeed('abc')).toMatch(/64 hex/)
    expect(checkSeed('zz'.repeat(32))).toMatch(/64 hex/)
  })
})

describe('checkRoundId', () => {
  it('accepts whole numbers 0 .. 2^64-1', () => {
    expect(checkRoundId('0')).toBeNull()
    expect(checkRoundId('18446744073709551615')).toBeNull()
  })

  it('rejects anything else', () => {
    expect(checkRoundId('')).toMatch(/whole number/)
    expect(checkRoundId('-1')).toMatch(/whole number/)
    expect(checkRoundId('1.5')).toMatch(/whole number/)
    expect(checkRoundId('18446744073709551616')).toMatch(/too large/)
  })
})
