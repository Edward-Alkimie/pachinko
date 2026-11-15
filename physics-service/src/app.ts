import { createServer, type Server } from 'node:http'

/**
 * HTTP app for the backend physics check.
 *   GET  /health  → { status: 'ok' }
 *   POST /verify  → re-run seed, compare each ball's outcome (implemented after runRound exists)
 */
export function createApp(): Server {
  return createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (req.method === 'GET' && req.url === '/health') {
      return send(200, { status: 'ok' })
    }
    if (req.method === 'POST' && req.url === '/verify') {
      return send(501, { error: 'verify not implemented yet' })
    }
    return send(404, { error: 'not found' })
  })
}
