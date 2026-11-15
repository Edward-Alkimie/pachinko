import { describe, expect, it } from 'vitest'
import { frameIndexAt, tallyAt, tickAt } from './playback'

describe('tickAt', () => {
  it('converts elapsed milliseconds to a simulation tick at 120 Hz', () => {
    expect(tickAt(0, 120)).toBe(0)
    expect(tickAt(1000, 120)).toBe(120)
    expect(tickAt(16.7, 120)).toBe(2)
  })
})

describe('frameIndexAt', () => {
  // frames are recorded after ticks 2, 4, 6, ... → frame i has tick 2(i+1)
  it('returns -1 before the first recorded frame', () => {
    expect(frameIndexAt(0, 2, 10)).toBe(-1)
    expect(frameIndexAt(1, 2, 10)).toBe(-1)
  })

  it('returns the latest frame recorded at or before the tick', () => {
    expect(frameIndexAt(2, 2, 10)).toBe(0)
    expect(frameIndexAt(3, 2, 10)).toBe(0)
    expect(frameIndexAt(4, 2, 10)).toBe(1)
  })

  it('stops at the last frame', () => {
    expect(frameIndexAt(1000, 2, 10)).toBe(9)
  })
})

describe('tallyAt', () => {
  const outcomes = [0, 2, 2, -1, 1]
  const landedAtTick = [10, 20, 30, -1, 40]

  it('counts only balls that have landed by the given tick', () => {
    expect(tallyAt(outcomes, landedAtTick, 0, 3)).toEqual({ perPocket: [0, 0, 0], landed: 0 })
    expect(tallyAt(outcomes, landedAtTick, 25, 3)).toEqual({ perPocket: [1, 0, 1], landed: 2 })
    expect(tallyAt(outcomes, landedAtTick, 999, 3)).toEqual({ perPocket: [1, 1, 2], landed: 4 })
  })
})
