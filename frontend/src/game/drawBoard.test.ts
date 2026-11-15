import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, buildPins } from '@pachinko/physics'
import { boardPixelSize, drawBoard } from './drawBoard'

/** Minimal fake 2D context that records what gets drawn. */
function fakeContext() {
  const calls: Record<string, number> = { arc: 0, fillRect: 0, fillText: 0, stroke: 0 }
  const ctx = {
    calls,
    fillStyle: '', strokeStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
    save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
    beginPath() {}, moveTo() {}, lineTo() {}, fill() {}, setLineDash() {},
    clearRect() {},
    arc() { calls.arc++ },
    fillRect() { calls.fillRect++ },
    fillText() { calls.fillText++ },
    stroke() { calls.stroke++ },
  }
  return ctx
}

describe('boardPixelSize', () => {
  it('includes the walls on both sides', () => {
    const { board, wallThickness } = DEFAULT_CONFIG
    expect(boardPixelSize(DEFAULT_CONFIG, 10)).toEqual({
      width: (board.width + 2 * wallThickness) * 10,
      height: (board.height + 2 * wallThickness) * 10,
    })
  })
})

describe('drawBoard', () => {
  it('draws every pin, wall, divider and pocket label', () => {
    const ctx = fakeContext()
    drawBoard(ctx as unknown as CanvasRenderingContext2D, DEFAULT_CONFIG, 10)
    const pockets = DEFAULT_CONFIG.pockets.length
    expect(ctx.calls.arc).toBe(buildPins(DEFAULT_CONFIG).length)
    // board background + 4 walls + (pockets - 1) dividers
    expect(ctx.calls.fillRect).toBe(1 + 4 + (pockets - 1))
    expect(ctx.calls.fillText).toBe(pockets)
    expect(ctx.calls.stroke).toBe(1) // launch zone line
  })
})

describe('drawBalls', () => {
  it('draws one circle per ball', async () => {
    const { drawBalls } = await import('./drawBoard')
    const ctx = fakeContext()
    const balls = [
      { id: 0, x: 10, y: 10 },
      { id: 1, x: 20, y: 30 },
    ]
    drawBalls(ctx as unknown as CanvasRenderingContext2D, balls, DEFAULT_CONFIG, 10)
    expect(ctx.calls.arc).toBe(2)
  })
})
