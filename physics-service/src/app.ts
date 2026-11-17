/**
 * HTTP app for the backend physics check (plain node:http, no framework).
 *
 *   GET  /health  → 200 { status: 'ok', configVersion }
 *   POST /verify  → re-run the seed, compare each ball (see verify.ts)
 *                   200 { ok, mismatches[], serverOutcomes, resultHash, ... }
 *                   400 bad JSON / bad field · 409 other physics version
 *                   413 body too large · 500 unexpected error
 *   anything else → 404
 *
 * Called by Django (backend/apps/results/physics_client.py) and usable by
 * Kiana's verifier. Contract: docs/SPEC.md §6.
 *
 * Note: runRound is synchronous (~1 s per round), so one verify blocks the
 * event loop. Fine for the MVP; move to worker threads if load requires it.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { DEFAULT_CONFIG, initPhysics, type MachineConfig } from '@pachinko/physics'
import { parseVerifyRequest, verifyRound } from './verify'

/** A /verify body is ~500 bytes (100 outcomes); 16 KiB leaves plenty of room. */
export const MAX_BODY_BYTES = 16 * 1024

/** Thrown by readBody when the body exceeds MAX_BODY_BYTES. */
class BodyTooLargeError extends Error {}

export function createApp(config: MachineConfig = DEFAULT_CONFIG): Server {
  return createServer((req, res) => {
    handle(req, res, config).catch((error: unknown) => {
      // Log the details for us; send only a generic message to the caller.
      console.error('physics-service: unhandled error', error)
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
    })
  })
}

async function handle(req: IncomingMessage, res: ServerResponse, config: MachineConfig): Promise<void> {
  if (req.method === 'GET' && req.url === '/health') {
    return send(res, 200, { status: 'ok', configVersion: config.version })
  }
  if (req.method === 'POST' && req.url === '/verify') {
    return handleVerify(req, res, config)
  }
  return send(res, 404, { error: 'not found' })
}

async function handleVerify(req: IncomingMessage, res: ServerResponse, config: MachineConfig): Promise<void> {
  let raw: string
  try {
    raw = await readBody(req, MAX_BODY_BYTES)
  } catch (error) {
    if (error instanceof BodyTooLargeError) return send(res, 413, { error: `body larger than ${MAX_BODY_BYTES} bytes` })
    throw error
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return send(res, 400, { error: 'body is not valid JSON' })
  }

  const parsed = parseVerifyRequest(body, config)
  if (!parsed.ok) return send(res, 400, { error: parsed.error })

  // Outcomes from another physics version can't be compared with this one.
  if (parsed.value.configVersion !== config.version) {
    return send(res, 409, {
      error: `configVersion ${parsed.value.configVersion} is not supported; this service runs ${config.version}`,
    })
  }

  await initPhysics() // loads Rapier's WASM once; instant afterwards
  return send(res, 200, verifyRound(parsed.value, config))
}

/**
 * Reads the request body as UTF-8, up to `limit` bytes. Past the limit it
 * keeps draining (so the client gets our 413 instead of a reset connection)
 * but stores nothing more, then rejects with BodyTooLargeError.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= limit) chunks.push(chunk)
    })
    req.on('end', () => {
      if (size > limit) reject(new BodyTooLargeError())
      else resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
