// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { ResultPanel } from './ResultPanel'

afterEach(cleanup)

const POCKETS = DEFAULT_CONFIG.pockets.length
const SEED = 'ab'.repeat(32)
const HASH = 'be'.repeat(32)
// 100 balls: 3 in pocket 0, 1 in pocket 2, 96 never landed.
const tally = { perPocket: [3, 0, 1, ...new Array(POCKETS - 3).fill(0)], landed: 4 }
const boardOutcomes = [0, 0, 0, 2, ...new Array(96).fill(-1)]

function renderPanel(props: Partial<Parameters<typeof ResultPanel>[0]> = {}) {
  render(
    <ResultPanel
      config={DEFAULT_CONFIG}
      status="done"
      tally={tally}
      seedHex={SEED}
      roundId={7n}
      resultHash={HASH}
      operatorOutcomes={null}
      error={null}
      {...props}
    />,
  )
}

describe('ResultPanel', () => {
  it('shows the board tally, the never-landed row, and the seed and board hash shortened', () => {
    renderPanel()
    expect(screen.getByRole('heading', { name: 'Board result' })).toBeTruthy()
    expect(screen.getByText('All balls are down.')).toBeTruthy()
    expect(document.querySelector('.landed')?.textContent).toBe('Landed 4 / 100')
    const rows = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(rows.slice(0, 3)).toEqual(['03', '10', '21'])
    expect(rows.at(-1)).toBe('–never landed96')
    expect(screen.getByText('abababab…abab').getAttribute('title')).toBe(SEED)
    expect(screen.getByText('bebebebe…bebe').getAttribute('title')).toBe(HASH)
    expect(screen.queryByText(/operator's counts/)).toBeNull()
  })

  it("shows the operator's counts next to the board's once the balls are down", () => {
    renderPanel({ operatorOutcomes: boardOutcomes })
    expect(screen.getByText("✓ The operator's counts match the board.")).toBeTruthy()
    expect(document.querySelectorAll('.differs')).toHaveLength(0)
  })

  it("marks every row where the operator's counts differ", () => {
    // The shortchange forgery: every ball reported as never landed.
    renderPanel({ operatorOutcomes: new Array(100).fill(-1) })
    expect(screen.getByText(/differ from the board in 3 rows/)).toBeTruthy()
    expect(document.querySelectorAll('.differs')).toHaveLength(3)
  })

  it("never shows the operator's counts before the balls are down", () => {
    renderPanel({ status: 'playing', operatorOutcomes: boardOutcomes })
    expect(screen.queryByText(/operator's counts/)).toBeNull()
    expect(screen.queryByText('Operator')).toBeNull()
  })

  it('shows dashes before a round and the error message when there is one', () => {
    renderPanel({
      status: 'error',
      tally: { perPocket: new Array(POCKETS).fill(0), landed: 0 },
      seedHex: null,
      roundId: null,
      resultHash: null,
      error: 'Simulation failed: boom',
    })
    expect(screen.getByText('Simulation failed: boom')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
