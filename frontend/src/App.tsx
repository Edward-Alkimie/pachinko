/**
 * Main page: Start / Replay controls, the animated board, and the result panel.
 *
 * Everything shown is derived from useRound's { result, tick }:
 *   - balls on the canvas = the recorded frame for the current tick
 *   - tally               = balls whose landing tick has passed
 *   - hash                = shown once playback finishes
 */
import { DEFAULT_CONFIG, randomSeedHex } from '@pachinko/physics'
import { ResultPanel } from './components/ResultPanel'
import { SeedInput } from './components/SeedInput'
import { PachinkoCanvas } from './game/PachinkoCanvas'
import { frameIndexAt, tallyAt } from './game/playback'
import { RECORD_EVERY, useRound } from './hooks/useRound'
import './App.css'

const CONFIG = DEFAULT_CONFIG
/** Local play uses round 1 until rounds come from the backend / Sui. */
const LOCAL_ROUND_ID = 1n

function App() {
  const { state, start } = useRound(CONFIG)
  const { result, tick, status } = state
  const isBusy = status === 'simulating'

  const frameIndex = result ? frameIndexAt(tick, RECORD_EVERY, result.frames.length) : -1
  const balls = result && frameIndex >= 0 ? result.frames[frameIndex].balls : []
  const tally = result
    ? tallyAt(result.outcomes, result.landedAtTick, tick, CONFIG.pockets.length)
    : { perPocket: CONFIG.pockets.map(() => 0), landed: 0 }

  return (
    <main className="app">
      <header>
        <h1>Project Pachinko</h1>
        <p className="meta">
          {CONFIG.version} · {CONFIG.timing.ballsPerRound} balls · {CONFIG.pockets.length} pockets
        </p>
      </header>

      <div className="layout">
        <PachinkoCanvas config={CONFIG} balls={balls} />

        <aside className="side">
          <button
            className="start"
            onClick={() => void start(randomSeedHex(), LOCAL_ROUND_ID)}
            disabled={isBusy}
          >
            {status === 'playing' ? 'Restart with new seed' : 'Start'}
          </button>
          <ResultPanel
            config={CONFIG}
            status={status}
            tally={tally}
            seedHex={state.seedHex}
            roundId={state.roundId}
            resultHash={status === 'done' ? (result?.resultHash ?? null) : null}
            error={state.error}
          />
          <SeedInput onReplay={(seed, roundId) => void start(seed, roundId)} disabled={isBusy} />
        </aside>
      </div>
    </main>
  )
}

export default App
