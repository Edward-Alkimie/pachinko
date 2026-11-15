const DEFAULT_PORT = 8100

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PHYSICS_SERVICE_PORT must be an integer 1-65535, got "${raw}"`)
  }
  return port
}

export const PORT = parsePort(process.env.PHYSICS_SERVICE_PORT)
