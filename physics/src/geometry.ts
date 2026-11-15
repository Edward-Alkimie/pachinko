import type { MachineConfig } from './config'

/** Axis-aligned box as centre + half extents (same shape Rapier's cuboid uses). */
export interface Box {
  readonly x: number
  readonly y: number
  readonly halfWidth: number
  readonly halfHeight: number
}

export interface PocketCentre {
  readonly id: number
  readonly x: number
  readonly y: number
}

/** Left, right, top, bottom walls, just outside the 0..width × 0..height board. */
export function buildWalls(config: MachineConfig): readonly Box[] {
  const { width: w, height: h } = config.board
  const t = config.wallThickness
  const side = { halfWidth: t / 2, halfHeight: h / 2 + t }
  const cap = { halfWidth: w / 2 + t, halfHeight: t / 2 }
  return [
    { x: -t / 2, y: h / 2, ...side },
    { x: w + t / 2, y: h / 2, ...side },
    { x: w / 2, y: -t / 2, ...cap },
    { x: w / 2, y: h + t / 2, ...cap },
  ]
}

/** One divider on each boundary between neighbouring pockets, standing on the floor. */
export function buildDividers(config: MachineConfig): readonly Box[] {
  const { pockets, pocketDepth, dividerThickness, board } = config
  return pockets.slice(1).map((p) => ({
    x: p.xMin,
    y: board.height - pocketDepth / 2,
    halfWidth: dividerThickness / 2,
    halfHeight: pocketDepth / 2,
  }))
}

export function pocketCentres(config: MachineConfig): readonly PocketCentre[] {
  const y = config.board.height - config.pocketDepth / 2
  return config.pockets.map((p) => ({ id: p.id, x: (p.xMin + p.xMax) / 2, y }))
}
