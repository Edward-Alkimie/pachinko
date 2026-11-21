/**
 * Determinism corpus in Node: `npm run determinism -- [rounds]` (default 1000). Prints the digest
 * and checkpoints; the same command on another OS, and `determinism.html` in each browser, must
 * print the same digest (project plan §7). Corpus definition: physics/src/determinism.ts.
 */
import { DEFAULT_CONFIG, initPhysics, runDeterminismCorpus } from '@pachinko/physics'

async function main() {
  const rounds = Number(process.argv[2] ?? 1000)
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error('usage: npm run determinism -- [rounds ≥ 1]')
  await initPhysics()
  const started = performance.now()
  const report = await runDeterminismCorpus(rounds, DEFAULT_CONFIG, (done) => {
    if (done % 100 === 0) process.stderr.write(`  ${done}/${rounds}\r`)
  })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  console.log(`platform   Node ${process.version} on ${process.platform}/${process.arch}`)
  console.log(`physics    ${report.configVersion}, ${report.rounds} rounds in ${seconds} s`)
  for (const c of report.checkpoints) console.log(`  @${String(c.rounds).padStart(5)}  ${c.digest}`)
  console.log(`digest     ${report.digest}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
