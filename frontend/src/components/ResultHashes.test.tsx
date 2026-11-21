// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ResultHashes } from './ResultHashes'

const SUBMITTED = 'aa'.repeat(32)
const OTHER = 'ff'.repeat(32)

afterEach(cleanup)

describe('ResultHashes', () => {
  it("shows the operator's hash while the balls are still falling, with no mark yet", () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="playing" replayHash={null} />)
    expect(screen.getByText('aaaaaaaa…aaaa').getAttribute('title')).toBe(SUBMITTED)
    expect(screen.getByText(/shown when the balls land/)).toBeTruthy()
    expect(screen.queryByText('✓')).toBeNull()
    expect(screen.queryByText('✗')).toBeNull()
  })

  it('marks the submitted hash ✓ when it matches the board', () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="done" replayHash={SUBMITTED} />)
    expect(screen.getAllByText('aaaaaaaa…aaaa')).toHaveLength(2)
    expect(screen.getByText('✓')).toBeTruthy()
  })

  it('marks the submitted hash ✗ when the board differs', () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="done" replayHash={OTHER} />)
    expect(screen.getByText('ffffffff…ffff')).toBeTruthy()
    expect(screen.getByText('✗')).toBeTruthy()
  })

  it('says when the board was interrupted', () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="interrupted" replayHash={null} />)
    expect(screen.getByText(/board was given another round/)).toBeTruthy()
  })

  it('adds what the payout used once final, marked against the board', () => {
    // An overturned forgery: the operator's hash is wrong, the payout used the board's.
    render(<ResultHashes submittedHash={OTHER} replay="done" replayHash={SUBMITTED} paidHash={SUBMITTED} />)
    expect(screen.getByText('Paid on')).toBeTruthy()
    expect(screen.getByText('✗')).toBeTruthy()
    expect(screen.getByText('✓')).toBeTruthy()
  })
})
