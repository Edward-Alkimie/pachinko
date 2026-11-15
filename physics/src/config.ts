/**
 * Machine configuration: board, pins, pockets, physics constants and timing.
 *
 * Units: centimetres and seconds. Coordinates: origin at the top-left, x to the
 * right, y DOWN (same as the canvas), so gravity is +y.
 *
 * Every value is a fixed number so the frontend, physics-service and verifier
 * all build the identical board. Changing any value = new `version`.
 */

export interface Vec2 {
  readonly x: number
  readonly y: number
}

export interface Material {
  readonly radius: number
  readonly restitution: number
  readonly friction: number
}

export interface BallSpec extends Material {
  readonly density: number
}

export interface PinGrid {
  readonly rows: number
  /** Pins in even rows; odd rows have cols - 1 pins, shifted half a spacing. */
  readonly cols: number
  readonly spacingX: number
  readonly spacingY: number
  /** y of the first pin row. */
  readonly topY: number
}

export interface Pocket {
  readonly id: number
  readonly xMin: number
  readonly xMax: number
}

export interface Launcher {
  /** Centre of the drop zone. */
  readonly x: number
  readonly y: number
  /** Balls start within x ± spreadX (picked from the seed). */
  readonly spreadX: number
  /** Initial horizontal speed within ± maxVx (picked from the seed). */
  readonly maxVx: number
}

export interface Timing {
  readonly tickHz: number
  readonly launchIntervalTicks: number
  readonly ballsPerRound: number
  /** Hard stop: balls not in a pocket by then count as outcome -1. */
  readonly maxTicks: number
}

export interface MachineConfig {
  readonly version: string
  readonly board: { readonly width: number; readonly height: number }
  readonly wallThickness: number
  readonly gravity: Vec2
  readonly ball: BallSpec
  readonly pin: Material
  readonly pinGrid: PinGrid
  /** Height of the pocket area at the bottom (dividers are this tall). */
  readonly pocketDepth: number
  readonly dividerThickness: number
  readonly pockets: readonly Pocket[]
  readonly launcher: Launcher
  readonly timing: Timing
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

export const DEFAULT_CONFIG: MachineConfig = deepFreeze({
  version: 'pachinko-v0.1.0',
  board: { width: 48, height: 64 },
  wallThickness: 2,
  // Real boards lean back slightly, so effective gravity is below 981 cm/s².
  gravity: { x: 0, y: 500 },
  // Real pachinko ball: 11 mm diameter.
  ball: { radius: 0.55, density: 1, restitution: 0.5, friction: 0.1 },
  pin: { radius: 0.2, restitution: 0.5, friction: 0.05 },
  pinGrid: { rows: 14, cols: 15, spacingX: 3, spacingY: 3, topY: 10 },
  pocketDepth: 6,
  dividerThickness: 0.3,
  pockets: [
    { id: 0, xMin: 0, xMax: 6 },
    { id: 1, xMin: 6, xMax: 13 },
    { id: 2, xMin: 13, xMax: 20 },
    { id: 3, xMin: 20, xMax: 28 },
    { id: 4, xMin: 28, xMax: 35 },
    { id: 5, xMin: 35, xMax: 42 },
    { id: 6, xMin: 42, xMax: 48 },
  ],
  launcher: { x: 24, y: 3, spreadX: 6, maxVx: 20 },
  timing: { tickHz: 120, launchIntervalTicks: 12, ballsPerRound: 100, maxTicks: 120 * 60 },
})

export function ballsPerSecond(config: MachineConfig): number {
  return config.timing.tickHz / config.timing.launchIntervalTicks
}

/** Pin centres, row by row, left to right. Pure arithmetic, so deterministic. */
export function buildPins(config: MachineConfig): readonly Vec2[] {
  const { rows, cols, spacingX, spacingY, topY } = config.pinGrid
  const centreX = config.board.width / 2
  const pins: Vec2[] = []
  for (let row = 0; row < rows; row++) {
    const isOdd = row % 2 === 1
    const count = isOdd ? cols - 1 : cols
    const firstX = centreX - ((count - 1) / 2) * spacingX
    for (let i = 0; i < count; i++) {
      pins.push({ x: firstX + i * spacingX, y: topY + row * spacingY })
    }
  }
  return pins
}

// ---------- validation ----------

function checkPositive(config: MachineConfig): string[] {
  const values: Record<string, number> = {
    'board.width': config.board.width,
    'board.height': config.board.height,
    'ball.radius': config.ball.radius,
    'ball.density': config.ball.density,
    'pin.radius': config.pin.radius,
    'pinGrid.spacingX': config.pinGrid.spacingX,
    'pinGrid.spacingY': config.pinGrid.spacingY,
    pocketDepth: config.pocketDepth,
    'timing.tickHz': config.timing.tickHz,
    'timing.launchIntervalTicks': config.timing.launchIntervalTicks,
    'timing.ballsPerRound': config.timing.ballsPerRound,
  }
  return Object.entries(values)
    .filter(([, v]) => !(Number.isFinite(v) && v > 0))
    .map(([name, v]) => `${name} must be a positive number (got ${v})`)
}

function checkPockets(config: MachineConfig): string[] {
  const { pockets, board } = config
  if (pockets.length === 0) return ['at least one pocket is required']
  const errors: string[] = []
  if (pockets[0].xMin !== 0) errors.push('first pocket must start at x = 0')
  if (pockets[pockets.length - 1].xMax !== board.width) {
    errors.push('last pocket must end at the board width')
  }
  pockets.forEach((p, i) => {
    if (p.id !== i) errors.push(`pocket ids must be 0..n-1 in order (pocket ${i} has id ${p.id})`)
    if (p.xMax <= p.xMin) errors.push(`pocket ${i} has zero or negative width`)
    if (i > 0 && p.xMin !== pockets[i - 1].xMax) {
      errors.push(`pocket ${i} must start where pocket ${i - 1} ends (gap or overlap)`)
    }
  })
  return errors
}

function checkPins(config: MachineConfig): string[] {
  const pins = buildPins(config)
  const r = config.pin.radius
  const diameter = 2 * config.ball.radius
  const pocketTop = config.board.height - config.pocketDepth
  const errors: string[] = []

  for (const p of pins) {
    if (p.x - r <= diameter || config.board.width - p.x - r <= diameter) {
      errors.push(`pin at (${p.x}, ${p.y}): gap to wall is smaller than a ball`)
    }
    if (p.y <= config.launcher.y || p.y + r >= pocketTop) {
      errors.push(`pin at (${p.x}, ${p.y}) must sit between the launcher and the pockets`)
    }
  }
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const gap = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y) - 2 * r
      if (gap <= diameter) {
        return [...errors, `pin gap ${gap.toFixed(2)} is too small for a ball (${diameter})`]
      }
    }
  }
  return errors
}

function checkLauncher(config: MachineConfig): string[] {
  const { x, y, spreadX } = config.launcher
  const r = config.ball.radius
  const errors: string[] = []
  if (x - spreadX - r <= 0 || x + spreadX + r >= config.board.width) {
    errors.push('launch zone (x ± spreadX) must fit inside the board')
  }
  if (y - r <= 0 || y >= config.pinGrid.topY) {
    errors.push('launch y must be inside the board and above the first pin row')
  }
  return errors
}

function checkTiming(config: MachineConfig): string[] {
  const { tickHz, launchIntervalTicks, ballsPerRound, maxTicks } = config.timing
  const errors: string[] = []
  if (!Number.isInteger(tickHz) || !Number.isInteger(launchIntervalTicks)) {
    errors.push('tickHz and launchIntervalTicks must be integers')
  }
  const lastLaunchTick = (ballsPerRound - 1) * launchIntervalTicks
  if (!(maxTicks > lastLaunchTick)) {
    errors.push(`maxTicks (${maxTicks}) must be greater than the last launch tick (${lastLaunchTick})`)
  }
  return errors
}

/** Returns a list of problems; an empty list means the config is valid. */
export function validateConfig(config: MachineConfig): string[] {
  return [
    ...checkPositive(config),
    ...checkPockets(config),
    ...checkPins(config),
    ...checkLauncher(config),
    ...checkTiming(config),
  ]
}
