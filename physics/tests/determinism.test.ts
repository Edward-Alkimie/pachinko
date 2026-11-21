import { beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import { CHECKPOINT_EVERY, corpusSeed, runDeterminismCorpus } from '../src/determinism'
import { initPhysics } from '../src/runRound'
import { seedToHex } from '../src/seed'

beforeAll(() => initPhysics())

describe('determinism corpus', () => {
  it('derives seed i as SHA-256 of the tag and the u32 index', () => {
    // printf 'PACHINKO-DETERMINISM-V1\x00\x00\x00\x00' | shasum -a 256
    expect(seedToHex(corpusSeed(0))).toBe('e8539d97b0904dcd961cd923f06c7856575e0134f8b07236b470908020a709f7')
    expect(seedToHex(corpusSeed(1))).not.toBe(seedToHex(corpusSeed(0)))
  })

  it('matches the pinned digest of the first 5 rounds (must match on every platform)', async () => {
    const report = await runDeterminismCorpus(5, DEFAULT_CONFIG)
    expect(report.digest).toBe('4f6cba1cb14a4004a09609d9eaa3e6ca07fbd2c2f9f927ba6ab6299c1850ec19')
    expect(report.configVersion).toBe(DEFAULT_CONFIG.version)
  })

  it('records a checkpoint every CHECKPOINT_EVERY rounds, the last one equal to the digest', async () => {
    const report = await runDeterminismCorpus(CHECKPOINT_EVERY, DEFAULT_CONFIG)
    expect(report.checkpoints).toEqual([{ rounds: CHECKPOINT_EVERY, digest: report.digest }])
  }, 60_000)
})
