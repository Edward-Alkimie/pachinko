import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  buildPins,
  ballsPerSecond,
  validateConfig,
  type MachineConfig,
} from '../src/config'

/** Returns a modified copy of the default config (never mutates the original). */
function withChanges(change: (c: MachineConfig) => MachineConfig): MachineConfig {
  return change(structuredClone(DEFAULT_CONFIG) as MachineConfig)
}

describe('DEFAULT_CONFIG', () => {
  it('is valid', () => {
    expect(validateConfig(DEFAULT_CONFIG)).toEqual([])
  })

  it('fires 10 balls per second at 120 Hz, 100 balls per round', () => {
    expect(DEFAULT_CONFIG.timing.tickHz).toBe(120)
    expect(DEFAULT_CONFIG.timing.launchIntervalTicks).toBe(12)
    expect(ballsPerSecond(DEFAULT_CONFIG)).toBe(10)
    expect(DEFAULT_CONFIG.timing.ballsPerRound).toBe(100)
  })

  it('is frozen so nobody can change the shared board by accident', () => {
    expect(Object.isFrozen(DEFAULT_CONFIG)).toBe(true)
    expect(Object.isFrozen(DEFAULT_CONFIG.pockets)).toBe(true)
    expect(Object.isFrozen(DEFAULT_CONFIG.pockets[0])).toBe(true)
  })

  it('has pockets that cover the full board width with no gaps or overlaps', () => {
    const { pockets, board } = DEFAULT_CONFIG
    expect(pockets[0].xMin).toBe(0)
    expect(pockets[pockets.length - 1].xMax).toBe(board.width)
    pockets.forEach((p, i) => {
      expect(p.id).toBe(i)
      if (i > 0) expect(p.xMin).toBe(pockets[i - 1].xMax)
    })
  })
})

describe('buildPins', () => {
  const pins = buildPins(DEFAULT_CONFIG)
  const { board, ball, pin, launcher } = DEFAULT_CONFIG
  const pocketTop = board.height - DEFAULT_CONFIG.pocketDepth

  it('is deterministic', () => {
    expect(buildPins(DEFAULT_CONFIG)).toEqual(pins)
  })

  it('creates a staggered grid (odd rows have one fewer pin)', () => {
    const { rows, cols } = DEFAULT_CONFIG.pinGrid
    const expected = Math.ceil(rows / 2) * cols + Math.floor(rows / 2) * (cols - 1)
    expect(pins).toHaveLength(expected)
  })

  it('keeps every pin inside the board, below the launcher and above the pockets', () => {
    for (const p of pins) {
      expect(p.x - pin.radius).toBeGreaterThan(0)
      expect(p.x + pin.radius).toBeLessThan(board.width)
      expect(p.y).toBeGreaterThan(launcher.y)
      expect(p.y + pin.radius).toBeLessThan(pocketTop)
    }
  })

  it('leaves room for a ball between any two pins and between pins and walls', () => {
    const diameter = 2 * ball.radius
    for (let i = 0; i < pins.length; i++) {
      expect(pins[i].x - pin.radius).toBeGreaterThan(diameter)
      expect(board.width - pins[i].x - pin.radius).toBeGreaterThan(diameter)
      for (let j = i + 1; j < pins.length; j++) {
        const gap = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y) - 2 * pin.radius
        expect(gap).toBeGreaterThan(diameter)
      }
    }
  })
})

describe('validateConfig catches broken configs', () => {
  it('pockets with a gap', () => {
    const bad = withChanges((c) => ({
      ...c,
      pockets: c.pockets.map((p, i) => (i === 1 ? { ...p, xMin: p.xMin + 1 } : p)),
    }))
    expect(validateConfig(bad).join()).toMatch(/pocket/i)
  })

  it('pins too close for a ball to pass', () => {
    const bad = withChanges((c) => ({ ...c, pinGrid: { ...c.pinGrid, spacingX: 1.2 } }))
    expect(validateConfig(bad).join()).toMatch(/gap/i)
  })

  it('maxTicks too small to launch every ball', () => {
    const bad = withChanges((c) => ({ ...c, timing: { ...c.timing, maxTicks: 100 } }))
    expect(validateConfig(bad).join()).toMatch(/maxTicks/)
  })

  it('launch area outside the board', () => {
    const bad = withChanges((c) => ({ ...c, launcher: { ...c.launcher, spreadX: 100 } }))
    expect(validateConfig(bad).join()).toMatch(/launch/i)
  })

  it('non-positive physical values', () => {
    const bad = withChanges((c) => ({ ...c, ball: { ...c.ball, radius: 0 } }))
    expect(validateConfig(bad).join()).toMatch(/radius/)
  })
})
