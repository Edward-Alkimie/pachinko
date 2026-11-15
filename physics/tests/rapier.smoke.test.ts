import { describe, it, expect } from 'vitest'
import RAPIER from '@dimforge/rapier2d-deterministic-compat'

describe('rapier smoke test', () => {
  it('initialises and drops a ball under gravity', async () => {
    await RAPIER.init()
    const world = new RAPIER.World({ x: 0, y: -9.81 })
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 10))
    world.createCollider(RAPIER.ColliderDesc.ball(0.5), body)
    for (let i = 0; i < 60; i++) world.step()
    expect(body.translation().y).toBeLessThan(10)
    world.free()
  })
})
