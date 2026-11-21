// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

type PlayOnBoard = (seedHex: string, roundId: bigint) => Promise<string | null>

/** A board whose replay lands at once with the golden hash. */
const landingBoard = () => vi.fn<PlayOnBoard>(async () => GOLDEN_HASH)

function renderPanel(boardBusy: boolean, playOnBoard = landingBoard()) {
  render(
    <VerifyPanel
      deployment={DEPLOYMENT}
      client={{} as ClientWithCoreApi}
      initialRound={1n}
      onRoundChange={vi.fn()}
      playOnBoard={playOnBoard}
      boardBusy={boardBusy}
    />,
  )
  return playOnBoard
}

afterEach(cleanup)

describe('VerifyPanel', () => {
  it('plays the round on a free board by itself, and checks it with that replay', async () => {
    mockSettledRound()
    const playOnBoard = renderPanel(false)
    expect(await screen.findByText(/Verified: the player was paid/)).toBeTruthy()
    expect(playOnBoard).toHaveBeenCalledWith(GOLDEN_SEED_HEX, 1n)
    expect(playOnBoard).toHaveBeenCalledTimes(1)
    // "This page's replay" and "Payout used" both show the golden hash; the payout is marked ✓.
    expect(screen.getAllByText('06e86fe4…8151')).toHaveLength(2)
    expect(screen.getByText('✓')).toBeTruthy()
  }, 30_000)

  it('waits for a click when the board is busy with another round', async () => {
    mockSettledRound()
    const playOnBoard = renderPanel(true)
    expect(await screen.findByText(/busy with another round/)).toBeTruthy()
    expect(screen.getByText(/replaying stops it/)).toBeTruthy()
    expect(playOnBoard).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Replay on the board' }))
    expect(await screen.findByText(/Verified: the player was paid/)).toBeTruthy()
    expect(playOnBoard).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('says so when the replay is stopped before the balls land', async () => {
    mockSettledRound()
    renderPanel(false, vi.fn<PlayOnBoard>(async () => null))
    expect(await screen.findByText(/stopped before the balls landed/)).toBeTruthy()
    expect(screen.queryByText(/Verified/)).toBeNull()
  }, 30_000)

  it('shows the seed and hashes shortened, and copies the full seed', async () => {
    mockSettledRound()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPanel(true)
    const seed = await screen.findByText('00010203…1e1f')
    expect(seed.getAttribute('title')).toBe(GOLDEN_SEED_HEX)
    expect(screen.getByText('06e86fe4…8151').getAttribute('title')).toBe(GOLDEN_HASH)
    expect(screen.getByText('npm run replay -- 00010203…1e1f 1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy seed' }))
    expect(writeText).toHaveBeenCalledWith(GOLDEN_SEED_HEX)
    expect(await screen.findByText('Copied')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Copy replay command' }))
    expect(writeText).toHaveBeenLastCalledWith(`npm run replay -- ${GOLDEN_SEED_HEX} 1`)
  }, 30_000)
})
