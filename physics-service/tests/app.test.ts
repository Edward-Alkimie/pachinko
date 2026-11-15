import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app'

describe('physics-service app', () => {
  const server = createApp()
  let baseUrl = ''

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('returns ok on GET /health', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('returns 501 on POST /verify until implemented', async () => {
    const res = await fetch(`${baseUrl}/verify`, { method: 'POST' })
    expect(res.status).toBe(501)
  })

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`${baseUrl}/nope`)
    expect(res.status).toBe(404)
  })
})
