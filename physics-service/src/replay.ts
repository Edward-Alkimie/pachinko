/**
 * Replay CLI logic (cli.ts wires it to the terminal):
 *
 *   npm run replay -- <seed> [roundId]
 *
 * Re-runs one round from its seed and prints a report: end tick, hash,
 * pocket tally and every ball's outcome. Same physics as the browser, so the
 * hash must match what the game showed for that seed + round.
 */
import { OUTCOME_NONE, parseSeed, runRound, type MachineConfig } from '@pachinko/physics'
import { fail, ok, parseRoundId, parseSeedHex, type Parsed } from './parse'

export const USAGE = 'Usage: npm run replay -- <seed: 64 hex chars> [roundId, default 1]'

export interface ReplayArgs {
  readonly seedHex: string
  readonly roundId: bigint
}

/** Parses the CLI arguments (without `node` and the script path). */
export function parseReplayArgs(argv: readonly string[]): Parsed<ReplayArgs> {
  if (argv.length < 1 || argv.length > 2) return fail(USAGE)
  const seed = parseSeedHex(argv[0])
  if (!seed.ok) return fail(`${seed.error}\n${USAGE}`)
  const roundId = parseRoundId(argv[1] ?? '1')
  if (!roundId.ok) return fail(`${roundId.error}\n${USAGE}`)
  return ok({ seedHex: seed.value, roundId: roundId.value })
}

/** Width of the longest tally bar in the report. */
const BAR_WIDTH = 40

/**
 * Runs the round and returns the printable report.
 * Requires `await initPhysics()` first.
 */
export function replayReport(seedHex: string, roundId: bigint, config: MachineConfig): string {
  const result = runRound(parseSeed(seedHex), roundId, config)
  const landed = result.outcomes.filter((o) => o !== OUTCOME_NONE).length

  // Count balls per pocket, then draw a bar scaled to the fullest pocket.
  const tally = config.pockets.map((_, id) => result.outcomes.filter((o) => o === id).length)
  const most = Math.max(1, ...tally)
  const bars = tally.map((count, id) => {
    const bar = '#'.repeat(Math.round((count / most) * BAR_WIDTH))
    return `pocket ${id}  ${String(count).padStart(3)}  ${bar}`
  })

  return [
    `config     ${config.version}`,
    `seed       ${seedHex}`,
    `roundId    ${roundId}`,
    `endTick    ${result.endTick}`,
    `landed     ${landed} / ${result.outcomes.length}`,
    `resultHash ${result.resultHash}`,
    '',
    ...bars,
    '',
    `outcomes   ${result.outcomes.join(' ')}`,
  ].join('\n')
}
