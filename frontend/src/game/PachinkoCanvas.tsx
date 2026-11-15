import { useEffect, useRef } from 'react'
import type { BallPosition, MachineConfig } from '@pachinko/physics'
import { boardPixelSize, drawBalls, drawBoard } from './drawBoard'
import { BOARD_COLORS } from './theme'

interface Props {
  config: MachineConfig
  /** Balls to draw this frame (empty = just the board). */
  balls?: readonly BallPosition[]
  /** Pixels per centimetre. */
  scale?: number
}

const DEFAULT_SCALE = 10
const NO_BALLS: readonly BallPosition[] = []

/**
 * Canvas showing the board and the current balls.
 * Redraws whenever `balls` changes (≈60 times a second during playback).
 * Board + ~30 balls is cheap enough to redraw fully each frame.
 */
export function PachinkoCanvas({ config, balls = NO_BALLS, scale = DEFAULT_SCALE }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = boardPixelSize(config, scale)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) {
      console.error('PachinkoCanvas: 2D canvas is not available in this browser')
      return
    }
    // Draw at device resolution (e.g. 2× on Retina) so pins and balls stay sharp,
    // while the CSS size below keeps the on-screen size the same.
    const dpr = window.devicePixelRatio || 1
    const pixelWidth = Math.round(size.width * dpr)
    const pixelHeight = Math.round(size.height * dpr)
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth
      canvas.height = pixelHeight
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = BOARD_COLORS.background
    ctx.fillRect(0, 0, size.width, size.height)
    drawBoard(ctx, config, scale)
    drawBalls(ctx, balls, config, scale)
  }, [config, balls, scale, size.width, size.height])

  return (
    <canvas
      ref={canvasRef}
      className="pachinko-canvas"
      style={{ width: size.width, height: size.height }}
      aria-label={`Pachinko board, ${config.pockets.length} pockets`}
    />
  )
}
