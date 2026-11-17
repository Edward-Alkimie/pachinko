/**
 * The backend physics check (POST /verify), as pure functions.
 *
 *   request body ─▶ parseVerifyRequest ─▶ VerifyRequest
 *                                            │
 *                     verifyRound ◀──────────┘
 *                       runRound(seed, roundId) again on the server
 *                       compareOutcomes(server, client) per ball
 *                                            │
 *                                            ▼
 *          { ok, mismatches[], serverOutcomes, resultHash, ... }
 *
 * The server's outcomes are authoritative (docs/SPEC.md §4): on any mismatch
 * the caller should store/settle the server result, not the client's.
 * Contract: docs/SPEC.md §6.
 */
import { OUTCOME_NONE, parseSeed, runRound, type MachineConfig } from '@pachinko/physics'
import { fail, ok, parseRoundId, parseSeedHex, type Parsed } from './parse'

/** A validated /verify request. */
export interface VerifyRequest {
  readonly seedHex: string
  readonly roundId: bigint
  /** Physics version the client simulated with (MachineConfig.version). */
  readonly configVersion: string
  /** Client's pocket id per ball, ball-id order; -1 = never landed. */
  readonly outcomes: readonly number[]
}

/** One ball where client and server disagree. */
export interface Mismatch {
  readonly ballId: number
  readonly client: number
  readonly server: number
}

/** The /verify reply body. */
export interface VerifyResult {
  /** True when every ball matches. */
  readonly ok: boolean
  readonly configVersion: string
  readonly seed: string
  /** Decimal string: u64 does not fit a JSON number. */
  readonly roundId: string
  /** Hash of the *server's* outcomes (docs/SPEC.md §3). */
  readonly resultHash: string
  readonly serverOutcomes: readonly number[]
  readonly mismatches: readonly Mismatch[]
}

/**
 * Checks the shape of an untrusted request body against `config`.
 * Does not check `configVersion` against the server's version: that is a
 * different error (409, see app.ts), not bad input.
 */
export function parseVerifyRequest(body: unknown, config: MachineConfig): Parsed<VerifyRequest> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return fail('body must be a JSON object')
  }
  const fields = body as Record<string, unknown>

  const seed = parseSeedHex(fields.seed)
  if (!seed.ok) return fail(seed.error)
  const roundId = parseRoundId(fields.roundId)
  if (!roundId.ok) return fail(roundId.error)
  if (typeof fields.configVersion !== 'string' || fields.configVersion === '') {
    return fail('configVersion must be a non-empty string (the physics version, e.g. pachinko-v0.1.0)')
  }
  const outcomes = parseOutcomes(fields.outcomes, config)
  if (!outcomes.ok) return fail(outcomes.error)

  return ok({ seedHex: seed.value, roundId: roundId.value, configVersion: fields.configVersion, outcomes: outcomes.value })
}

/** One integer per ball, each a pocket id or -1. */
function parseOutcomes(input: unknown, config: MachineConfig): Parsed<readonly number[]> {
  const balls = config.timing.ballsPerRound
  const lastPocket = config.pockets.length - 1
  if (!Array.isArray(input)) return fail(`outcomes must be an array of ${balls} pocket ids`)
  if (input.length !== balls) return fail(`outcomes must have exactly ${balls} entries (got ${input.length})`)

  for (const [i, value] of input.entries()) {
    const isValid = Number.isInteger(value) && value >= OUTCOME_NONE && value <= lastPocket
    if (!isValid) return fail(`outcomes[${i}] must be an integer from ${OUTCOME_NONE} to ${lastPocket}`)
  }
  return ok(input as number[])
}

/** Balls whose client outcome differs from the server's, in ball-id order. */
export function compareOutcomes(server: readonly number[], client: readonly number[]): Mismatch[] {
  return server.flatMap((serverOutcome, ballId) =>
    client[ballId] === serverOutcome ? [] : [{ ballId, client: client[ballId], server: serverOutcome }],
  )
}

/**
 * Re-runs the round on the server and compares every ball.
 * Requires `await initPhysics()` first. Takes ~1 s of CPU (100 balls).
 */
export function verifyRound(request: VerifyRequest, config: MachineConfig): VerifyResult {
  // recordEvery 0 (default): no frames needed, only outcomes + hash.
  const server = runRound(parseSeed(request.seedHex), request.roundId, config)
  const mismatches = compareOutcomes(server.outcomes, request.outcomes)
  return {
    ok: mismatches.length === 0,
    configVersion: config.version,
    seed: request.seedHex,
    roundId: request.roundId.toString(),
    resultHash: server.resultHash,
    serverOutcomes: server.outcomes,
    mismatches,
  }
}
