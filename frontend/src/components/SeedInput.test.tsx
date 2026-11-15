// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SeedInput } from './SeedInput'

afterEach(cleanup)

const fill = (seed: string, round = '1') => {
  fireEvent.change(screen.getByLabelText('Seed'), { target: { value: seed } })
  fireEvent.change(screen.getByLabelText('Round'), { target: { value: round } })
  fireEvent.click(screen.getByRole('button', { name: 'Replay seed' }))
}

describe('SeedInput', () => {
  it('calls onReplay with the normalised seed and a bigint round id', () => {
    const onReplay = vi.fn()
    render(<SeedInput onReplay={onReplay} />)
    fill(' 0x' + 'AB'.repeat(32) + ' ', '42')
    expect(onReplay).toHaveBeenCalledWith('ab'.repeat(32), 42n)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows an error and does not replay for a bad seed', () => {
    const onReplay = vi.fn()
    render(<SeedInput onReplay={onReplay} />)
    fill('xyz')
    expect(screen.getByRole('alert').textContent).toMatch(/64 hex/)
    expect(onReplay).not.toHaveBeenCalled()
  })

  it('shows an error for a bad round id', () => {
    const onReplay = vi.fn()
    render(<SeedInput onReplay={onReplay} />)
    fill('ab'.repeat(32), '-3')
    expect(screen.getByRole('alert').textContent).toMatch(/whole number/)
    expect(onReplay).not.toHaveBeenCalled()
  })

  it('disables the button while busy', () => {
    render(<SeedInput onReplay={vi.fn()} disabled />)
    expect((screen.getByRole('button', { name: 'Replay seed' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
