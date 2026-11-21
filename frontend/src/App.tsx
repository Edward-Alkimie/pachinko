/**
 * Main page: on-chain play, the Replay form, the animated board, and the result panel.
 *
 * Everything shown is derived from useRound's { result, tick }:
 *   - balls on the canvas = the recorded frame for the current tick
 *   - tally               = balls whose landing tick has passed
 *   - hash                = shown once playback finishes
 *
 * Sign-in (useAuth + AuthPanel) sits above the controls. Playing does not
 * need an account yet; rounds will be tied to the signed-in user later.
 *
 * OnchainPanel plays a round on Sui testnet: the wallet bets, and once the seed is
 * on-chain it is played here with useRound.start, whose result hash the panel compares with
 * the submitted one (and offers a challenge on a mismatch). The Replay form re-runs any seed
 * (e.g. an on-chain round's) the same way, so anyone can check a result.
 */
import { useCallback } from 'react'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { AuthPanel } from './components/AuthPanel'
import { OnchainPanel } from './components/OnchainPanel'
import { ResultPanel } from './components/ResultPanel'
import { SeedInput } from './components/SeedInput'
import { PachinkoCanvas } from './game/PachinkoCanvas'
import { frameIndexAt, tallyAt } from './game/playback'
import { useAuth } from './hooks/useAuth'
import { RECORD_EVERY, useRound } from './hooks/useRound'
import './App.css'

const CONFIG = DEFAULT_CONFIG

function App() {
  const { state: authState, ...authActions } = useAuth()
  const { state, start } = useRound(CONFIG)
  const { result, tick, status } = state
  const isBusy = status === 'simulating'
  const playSeed = useCallback((seedHex: string, roundId: bigint) => void start(seedHex, roundId), [start])
  // On-chain rounds also need the replay's hash, to compare with the submitted result.
  const playOnchainSeed = useCallback(
    async (seedHex: string, roundId: bigint) => (await start(seedHex, roundId))?.resultHash ?? null,
    [start],
  )

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
          <AuthPanel state={authState} {...authActions} />
          <OnchainPanel onSeed={playOnchainSeed} />
          <ResultPanel
            config={CONFIG}
            status={status}
            tally={tally}
            seedHex={state.seedHex}
            roundId={state.roundId}
            resultHash={status === 'done' ? (result?.resultHash ?? null) : null}
            error={state.error}
          />
          <SeedInput onReplay={playSeed} disabled={isBusy} />
        </aside>
      </div>
    </main>
  )
}

export default App
