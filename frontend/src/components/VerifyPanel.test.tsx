// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as chain from '@pachinko/chain'
import { RoundStatus, type Deployment, type RoundHistory } from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { VerifyPanel } from './VerifyPanel'

vi.mock('@pachinko/chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pachinko/chain')>()),
  findRoundByNumber: vi.fn(),
  fetchRound: vi.fn(),
  fetchRoundHistory: vi.fn(),
}))

// docs/SPEC.md §3 golden fixture: seed 000102…1f, round 1.
const GOLDEN_SEED = Uint8Array.from({ length: 32 }, (_, i) => i)
const GOLDEN_SEED_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const GOLDEN_HASH = '06e86fe4ce78394b27ef1d942c164292ce763d94aa54ca20f82ccdb24b818151'
const DEPLOYMENT = { packageId: `0x${'01'.repeat(32)}` } as Deployment

function mockSettledRound() {
  vi.mocked(chain.findRoundByNumber).mockResolvedValue({ round: '0xab', bet: '10' } as Awaited<
    ReturnType<typeof chain.findRoundByNumber>
  >)
  vi.mocked(chain.fetchRound).mockResolvedValue({
    objectId: '0xab',
    roundId: 1n,
    player: `0x${'02'.repeat(32)}`,
    configVersion: DEFAULT_CONFIG.version,
    seed: GOLDEN_SEED,
    betMist: 0n,
    status: RoundStatus.Finalized,
    submitDeadlineMs: 0,
  })
  vi.mocked(chain.fetchRoundHistory).mockResolvedValue({
    submitted: null,
    challenged: null,
    committee: null,
    votes: [],
    resolved: null,
    finalized: { result_hash: Array.from(Buffer.from(GOLDEN_HASH, 'hex')), payout: '10' },
    refunded: null,
  } as unknown as RoundHistory)
}

function renderPanel(boardBusy: boolean, onWatch = vi.fn()) {
  render(
    <VerifyPanel
      deployment={DEPLOYMENT}
      client={{} as ClientWithCoreApi}
      initialRound={1n}
      onRoundChange={vi.fn()}
      onWatch={onWatch}
      boardBusy={boardBusy}
    />,
  )
  return onWatch
}

afterEach(cleanup)

describe('VerifyPanel', () => {
  it('shows the verdict and plays the verified round on a free board, once', async () => {
    mockSettledRound()
    const onWatch = renderPanel(false)
    expect(await screen.findByText(/Verified: the player was paid/)).toBeTruthy()
    await waitFor(() => expect(onWatch).toHaveBeenCalledWith(GOLDEN_SEED_HEX, 1n))
    expect(onWatch).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('does not take over a busy board; "Watch again" is there instead', async () => {
    mockSettledRound()
    const onWatch = renderPanel(true)
    expect(await screen.findByRole('button', { name: 'Watch again' })).toBeTruthy()
    expect(onWatch).not.toHaveBeenCalled()
  }, 30_000)
})
