/**
 * Replay CLI entry point:  npm run replay -- <seed> [roundId]
 * The logic lives in replay.ts (tested); this file only touches the terminal.
 * Exit codes: 0 ok · 2 bad arguments.
 */
import { DEFAULT_CONFIG, initPhysics } from '@pachinko/physics'
import { parseReplayArgs, replayReport } from './replay'

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.error)
    process.exitCode = 2
    return
  }
  await initPhysics()
  console.info(replayReport(args.value.seedHex, args.value.roundId, DEFAULT_CONFIG))
}

void main()
