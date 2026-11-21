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

  it('marks the submitted hash ✓ when it matches the replay', () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="done" replayHash={SUBMITTED} />)
    expect(screen.getAllByText('aaaaaaaa…aaaa')).toHaveLength(2)
    expect(screen.getByText('✓')).toBeTruthy()
  })

  it('marks the submitted hash ✗ when the replay differs', () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="done" replayHash={OTHER} />)
    expect(screen.getByText('ffffffff…ffff')).toBeTruthy()
    expect(screen.getByText('✗')).toBeTruthy()
  })

  it('says when the replay was interrupted', () => {
    render(<ResultHashes submittedHash={SUBMITTED} replay="interrupted" replayHash={null} />)
    expect(screen.getByText(/replay was interrupted/)).toBeTruthy()
  })
})
