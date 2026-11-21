/**
 * determinism.html: runs the physics determinism corpus in this browser and prints the digest,
 * for comparing against Node and other browsers (project plan §7). Plain DOM, no React.
 */
import { DEFAULT_CONFIG, initPhysics, runDeterminismCorpus } from '@pachinko/physics'

const roundsInput = document.querySelector<HTMLInputElement>('#rounds')!
const runButton = document.querySelector<HTMLButtonElement>('#run')!
const out = document.querySelector<HTMLPreElement>('#out')!

/** Lets the browser paint between rounds. */
const nextFrame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

runButton.addEventListener('click', async () => {
  const rounds = Number(roundsInput.value)
  if (!Number.isInteger(rounds) || rounds < 1) {
    out.textContent = 'Rounds must be a whole number ≥ 1.'
    return
  }
  runButton.disabled = true
  out.textContent = 'Loading physics…'
  await initPhysics()
  const started = performance.now()
  const report = await runDeterminismCorpus(rounds, DEFAULT_CONFIG, async (done) => {
    if (done % 10 === 0) {
      out.textContent = `Running… ${done}/${rounds}`
      await nextFrame()
    }
  })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  out.textContent = [
    `platform   ${navigator.userAgent}`,
    `physics    ${report.configVersion}, ${report.rounds} rounds in ${seconds} s`,
    ...report.checkpoints.map((c) => `  @${String(c.rounds).padStart(5)}  ${c.digest}`),
    `digest     ${report.digest}`,
  ].join('\n')
  runButton.disabled = false
})
