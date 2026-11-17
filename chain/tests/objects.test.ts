import { fromHex } from '@mysten/sui/utils'
import { describe, expect, it } from 'vitest'
import { RoundStatus, parseRound, parseSubmission } from '../src/objects'

// Real BCS bytes read from testnet after the honest run of 2026-11-17
// (round 0x5fea…45bc, package 0xaed7…034f). They pin our layouts to what Move actually stores.
const ROUND_BCS = [
  '5feaf35149795ae4476996173b3afa86cc142a7da99906d60cdca1ef54af45bc0100000000000000758488b191a77182',
  '3ea215efe10e44d7f8112524e994f3fcf686afdce89106630f70616368696e6b6f2d76302e312e30200d2af0c6cb3efd',
  '150c8ab10b5d832bb5c25dc4f3a4325f746a3189e334cca3e0000000000000000004',
].join('')
const SUBMISSION_BCS = [
  '3220f0027d376f7af2b71a9fc83339e78a6e22534788e4075b42ed32ef98548c758488b191a771823ea215efe10e44d7',
  'f8112524e994f3fcf686afdce89106636402000000010003000600010003000000060004000300010004000600060005',
  '000500010002000000040003000000020006000300030000000600020001000500030004000500000003000000060006',
  '000100030001000600030004000300060004000500040005000300020000000400040005000600010006000000010006',
  '000100020003000400040005000000050000000600020003000000050002000200040000000100050000000300060004',
  '0003000200020005000600030006000000060004000100060020812ee33c5d29a5831bf1d495df7e771cadd1afc81b43',
  'd0546fbce57950ff6b02f635a9eaa10100000000000000000000000000000000000000',
].join('')

describe('parseRound', () => {
  it('decodes a finalized testnet round', () => {
    const round = parseRound(fromHex(ROUND_BCS))
    expect(round.objectId).toBe('0x5feaf35149795ae4476996173b3afa86cc142a7da99906d60cdca1ef54af45bc')
    expect(round.roundId).toBe(1n)
    expect(round.player).toBe('0x758488b191a771823ea215efe10e44d7f8112524e994f3fcf686afdce8910663')
    expect(round.configVersion).toBe('pachinko-v0.1.0')
    expect(round.seed && Buffer.from(round.seed).toString('hex')).toBe(
      '0d2af0c6cb3efd150c8ab10b5d832bb5c25dc4f3a4325f746a3189e334cca3e0',
    )
    expect(round.betMist).toBe(0n) // the bet left the round when it was finalized
    expect(round.status).toBe(RoundStatus.Finalized)
  })
})

describe('parseSubmission', () => {
  it('decodes the stored result of that round', () => {
    const submission = parseSubmission(fromHex(SUBMISSION_BCS))
    expect(submission.outcomes).toHaveLength(100)
    const tally = [0, 1, 2, 3, 4, 5, 6].map((p) => submission.outcomes.filter((o) => o === p).length)
    expect(tally).toEqual([15, 12, 11, 17, 14, 12, 19]) // as printed by round:testnet
    expect(Buffer.from(submission.resultHash).toString('hex')).toBe(
      '812ee33c5d29a5831bf1d495df7e771cadd1afc81b43d0546fbce57950ff6b02',
    )
    expect(submission.operator).toBe('0x758488b191a771823ea215efe10e44d7f8112524e994f3fcf686afdce8910663')
    expect(submission.challenger).toBeNull()
    expect(submission.deadlineMs).toBeGreaterThan(0)
  })
})
