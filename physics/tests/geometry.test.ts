import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config'
import { buildDividers, buildWalls, pocketCentres } from '../src/geometry'

const { board, wallThickness: t, pockets, pocketDepth } = DEFAULT_CONFIG

describe('buildWalls', () => {
  const walls = buildWalls(DEFAULT_CONFIG)

  it('returns left, right, top and bottom walls just outside the board', () => {
    expect(walls).toHaveLength(4)
    const [left, right, top, bottom] = walls
    expect(left.x + left.halfWidth).toBe(0)
    expect(right.x - right.halfWidth).toBe(board.width)
    expect(top.y + top.halfHeight).toBe(0)
    expect(bottom.y - bottom.halfHeight).toBe(board.height)
  })

  it('closes the corners (side walls span the full height incl. top/bottom walls)', () => {
    const [left, , top] = walls
    expect(left.halfHeight * 2).toBe(board.height + 2 * t)
    expect(top.halfWidth * 2).toBe(board.width + 2 * t)
  })
})

describe('buildDividers', () => {
  const dividers = buildDividers(DEFAULT_CONFIG)

  it('puts one divider between each pair of neighbouring pockets', () => {
    expect(dividers).toHaveLength(pockets.length - 1)
    dividers.forEach((d, i) => expect(d.x).toBe(pockets[i + 1].xMin))
  })

  it('makes dividers stand on the floor, pocketDepth tall', () => {
    for (const d of dividers) {
      expect(d.y + d.halfHeight).toBe(board.height)
      expect(d.halfHeight * 2).toBe(pocketDepth)
    }
  })
})

describe('pocketCentres', () => {
  it('returns the middle of each pocket', () => {
    const centres = pocketCentres(DEFAULT_CONFIG)
    expect(centres).toHaveLength(pockets.length)
    expect(centres[0]).toEqual({ id: 0, x: 3, y: board.height - pocketDepth / 2 })
  })
})
