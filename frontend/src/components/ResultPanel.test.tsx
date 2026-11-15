// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { ResultPanel } from './ResultPanel'

afterEach(cleanup)

const tally = { perPocket: [3, 0, 1, 0, 0, 0, 2], landed: 6 }

describe('ResultPanel', () => {
  it('shows the status, landed count, per-pocket counts, seed and hash', () => {
    render(
      <ResultPanel
        config={DEFAULT_CONFIG}
        status="done"
        tally={tally}
        seedHex="ab12"
        roundId={7n}
        resultHash="beef"
        error={null}
      />,
    )
    expect(screen.getByText('Round finished.')).toBeTruthy()
    expect(document.querySelector('.landed')?.textContent).toBe('Landed 6 / 100')
    const counts = screen.getAllByRole('listitem').map((li) => li.textContent)
    expect(counts).toEqual(['03', '10', '21', '30', '40', '50', '62'])
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.getByText('ab12')).toBeTruthy()
    expect(screen.getByText('beef')).toBeTruthy()
  })

  it('shows dashes before a round and the error message when there is one', () => {
    render(
      <ResultPanel
        config={DEFAULT_CONFIG}
        status="error"
        tally={{ perPocket: [0, 0, 0, 0, 0, 0, 0], landed: 0 }}
        seedHex={null}
        roundId={null}
        resultHash={null}
        error="Simulation failed: boom"
      />,
    )
    expect(screen.getByText('Simulation failed: boom')).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(3)
  })
})
