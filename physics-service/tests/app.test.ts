/**
 * HTTP layer: routes, status codes and body handling. The comparison logic
 * itself is covered in verify.test.ts.
 */
import type { AddressInfo } from 'node:net'
import { DEFAULT_CONFIG, initPhysics, parseSeed, runRound } from '@pachinko/physics'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MAX_BODY_BYTES, createApp } from '../src/app'

/** Fields the tests read from JSON replies (res.json() is untyped). */
interface Reply {
  status?: string
  configVersion?: string
  ok?: boolean
  mismatches?: unknown[]
  serverOutcomes?: number[]
  error?: string
}
const json = async (res: Response): Promise<Reply> => (await res.json()) as Reply

const GOLDEN_SEED = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('')

describe('physics-service app', () => {
  const server = createApp()
  let baseUrl = ''
  let goldenOutcomes: number[] = []

  beforeAll(async () => {
    await new Promise<void>((resolve) => server.listen(0, resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await initPhysics()
    goldenOutcomes = [...runRound(parseSeed(GOLDEN_SEED), 1n, DEFAULT_CONFIG).outcomes]
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  /** POSTs a JSON (or raw string) body to /verify. */
  const verify = (payload: unknown) =>
    fetch(`${baseUrl}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    })

  const validBody = (overrides: Record<string, unknown> = {}) => ({
    seed: GOLDEN_SEED,
    roundId: '1',
    configVersion: DEFAULT_CONFIG.version,
    outcomes: goldenOutcomes,
    ...overrides,
  })

  it('returns ok on GET /health with the physics version', async () => {
    const res = await fetch(`${baseUrl}/health`)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ status: 'ok', configVersion: DEFAULT_CONFIG.version })
  })

  it('POST /verify: honest outcomes → 200 ok', async () => {
    const res = await verify(validBody())
    expect(res.status).toBe(200)
    const data = await json(res)
    expect(data.ok).toBe(true)
    expect(data.mismatches).toEqual([])
    expect(data.serverOutcomes).toEqual(goldenOutcomes)
  })

  it('POST /verify: tampered outcome → 200 with the mismatched ball', async () => {
    const tampered = [...goldenOutcomes]
    tampered[5] = goldenOutcomes[5] === 0 ? 1 : 0
    const data = await json(await verify(validBody({ outcomes: tampered })))
    expect(data.ok).toBe(false)
    expect(data.mismatches).toEqual([{ ballId: 5, client: tampered[5], server: goldenOutcomes[5] }])
  })

  it('POST /verify: invalid JSON → 400', async () => {
    const res = await verify('{not json')
    expect(res.status).toBe(400)
    expect((await json(res)).error).toMatch(/JSON/)
  })

  it('POST /verify: invalid field → 400 with the reason', async () => {
    const res = await verify(validBody({ seed: 'abc' }))
    expect(res.status).toBe(400)
    expect((await json(res)).error).toMatch(/seed/)
  })

  it('POST /verify: other physics version → 409', async () => {
    const res = await verify(validBody({ configVersion: 'pachinko-v9.9.9' }))
    expect(res.status).toBe(409)
    expect((await json(res)).error).toMatch(/pachinko-v9\.9\.9/)
  })

  it('POST /verify: body larger than the limit → 413', async () => {
    const res = await verify('x'.repeat(MAX_BODY_BYTES + 1))
    expect(res.status).toBe(413)
  })

  it('returns 404 for unknown routes and wrong methods', async () => {
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/verify`)).status).toBe(404) // GET /verify
  })
})
