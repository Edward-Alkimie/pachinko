import {
  buildDividers,
  buildPins,
  buildWalls,
  pocketCentres,
  type BallPosition,
  type Box,
  type MachineConfig,
} from '@pachinko/physics'
import { BOARD_COLORS } from './theme'

const LABEL_FONT_PX = 16
const LAUNCH_DASH_CM = 0.6

/** Canvas size in CSS pixels for a given scale (pixels per centimetre). */
export function boardPixelSize(config: MachineConfig, scale: number) {
  const t = config.wallThickness
  return {
    width: (config.board.width + 2 * t) * scale,
    height: (config.board.height + 2 * t) * scale,
  }
}

function fillBox(ctx: CanvasRenderingContext2D, b: Box) {
  ctx.fillRect(b.x - b.halfWidth, b.y - b.halfHeight, b.halfWidth * 2, b.halfHeight * 2)
}

/**
 * Draws the static board. Works in board units (cm): the context is scaled by
 * `scale` and shifted so the walls (which sit at negative coordinates) are visible.
 */
export function drawBoard(ctx: CanvasRenderingContext2D, config: MachineConfig, scale: number) {
  const t = config.wallThickness
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(t, t)

  ctx.fillStyle = BOARD_COLORS.board
  ctx.fillRect(0, 0, config.board.width, config.board.height)

  ctx.fillStyle = BOARD_COLORS.wall
  buildWalls(config).forEach((w) => fillBox(ctx, w))

  ctx.fillStyle = BOARD_COLORS.divider
  buildDividers(config).forEach((d) => fillBox(ctx, d))

  ctx.fillStyle = BOARD_COLORS.pin
  for (const p of buildPins(config)) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, config.pin.radius, 0, Math.PI * 2)
    ctx.fill()
  }

  const { x, y, spreadX } = config.launcher
  ctx.strokeStyle = BOARD_COLORS.launchZone
  ctx.lineWidth = 0.15
  ctx.setLineDash([LAUNCH_DASH_CM, LAUNCH_DASH_CM / 2])
  ctx.beginPath()
  ctx.moveTo(x - spreadX, y)
  ctx.lineTo(x + spreadX, y)
  ctx.stroke()

  ctx.restore()

  // Labels are drawn in pixel space: tiny scaled-up fonts render badly in some browsers.
  ctx.fillStyle = BOARD_COLORS.pocketLabel
  ctx.font = `bold ${LABEL_FONT_PX}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  pocketCentres(config).forEach((c) =>
    ctx.fillText(String(c.id), (c.x + t) * scale, (c.y + t) * scale),
  )
}

const BALL_SHINE_OFFSET = 0.3

/**
 * Draws the moving balls on top of the board.
 * Uses the same cm → pixel transform as drawBoard (scale, then shift by the wall).
 */
export function drawBalls(
  ctx: CanvasRenderingContext2D,
  balls: readonly BallPosition[],
  config: MachineConfig,
  scale: number,
) {
  const t = config.wallThickness
  const r = config.ball.radius
  ctx.save()
  ctx.scale(scale, scale)
  ctx.translate(t, t)
  for (const ball of balls) {
    // Ball body.
    ctx.fillStyle = BOARD_COLORS.ball
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, r, 0, Math.PI * 2)
    ctx.fill()
    // Small highlight so balls read as shiny steel; fillRect keeps it cheap.
    ctx.fillStyle = BOARD_COLORS.ballShine
    ctx.fillRect(ball.x - BALL_SHINE_OFFSET, ball.y - BALL_SHINE_OFFSET, 0.25, 0.25)
  }
  ctx.restore()
}
