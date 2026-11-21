/**
 * Main page: on-chain play, the Verify view (with the Replay form), the animated board, and the result panel.
 *
 * Everything shown is derived from useRound's { result, tick }:
 *   - balls on the canvas = the recorded frame for the current tick
 *   - tally               = balls whose landing tick has passed
 *   - hash                = shown once playback finishes
 *
 * The board is the reference result: simulated here from the seed, it is what the operator must report.
 * The panels pass on each operator claim they read (`reportClaim`, keyed by seed + round, so a custom
 * seed never matches); the Board result shows it next to the board's counts once the balls are down.
 *
 * Sign-in (useAuth + AuthPanel) sits above the controls. Playing does not
 * need an account yet; rounds will be tied to the signed-in user later.
 *
 * OnchainPanel plays a round on Sui testnet: the wallet bets, and once the seed is
 * on-chain it is played here with useRound.start, whose result hash the panel compares with
 * the submitted one (and offers a challenge on a mismatch).
 *
 * Two views share the board: Play (above) and Verify: VerifyPanel checks any round from the chain
 * (`#verify/<round>` links to it), and the Replay form re-runs any seed, on-chain or not. Both views
 * stay mounted, so switching never stops an on-chain round being followed.
 */
import { useCallback, useMemo, useState } from 'react'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { AuthPanel } from './components/AuthPanel'
import { OnchainPanel } from './components/OnchainPanel'
import { ResultPanel } from './components/ResultPanel'
import { SeedInput } from './components/SeedInput'
import { VerifyPanel } from './components/VerifyPanel'
import { PachinkoCanvas } from './game/PachinkoCanvas'
import { frameIndexAt, tallyAt } from './game/playback'
import { useAuth } from './hooks/useAuth'
import { RECORD_EVERY, useRound } from './hooks/useRound'
import { ONCHAIN } from './onchain/deployment'
import { getDAppKit } from './onchain/dappKit'
import { parseRoute, routeHash, type Route } from './onchain/verify'
import './App.css'

const CONFIG = DEFAULT_CONFIG

const claimKey = (seedHex: string, roundId: bigint) => `${seedHex}:${roundId}`

/** Shows `route` in the address bar without adding a history entry. */
function showRoute(route: Route) {
  window.history.replaceState(null, '', routeHash(route) || window.location.pathname)
}

function App() {
  const { state: authState, ...authActions } = useAuth()
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash))
  // The Verify view reads with the wallet kit's chain client (created once).
  const verify = useMemo(
    () => (ONCHAIN.enabled ? { deployment: ONCHAIN.deployment, client: getDAppKit().getClient() } : null),
    [],
  )
  const goTo = (next: Route) => {
    setRoute(next)
    showRoute(next)
  }
  // The operator's claimed outcomes per round, keyed by seed + round.
  const [claims, setClaims] = useState<Record<string, readonly number[]>>({})
  const reportClaim = useCallback((seedHex: string, roundId: bigint, outcomes: readonly number[]) => {
    const key = claimKey(seedHex, roundId)
    setClaims((c) => (c[key] ? c : { ...c, [key]: outcomes }))
  }, [])
  const { state, start } = useRound(CONFIG)
  const { result, tick, status } = state
  const isBusy = status === 'simulating'
  const playSeed = useCallback((seedHex: string, roundId: bigint) => void start(seedHex, roundId), [start])
  // On-chain and Verify rounds also need the replay's hash, to compare with the chain. It arrives
  // when playback ends, so the match / mismatch never shows before the balls have landed.
  const playReplay = useCallback(
    async (seedHex: string, roundId: bigint) => (await start(seedHex, roundId))?.resultHash ?? null,
    [start],
  )

  const frameIndex = result ? frameIndexAt(tick, RECORD_EVERY, result.frames.length) : -1
  const balls = result && frameIndex >= 0 ? result.frames[frameIndex].balls : []
  const claim = state.seedHex && state.roundId !== null ? (claims[claimKey(state.seedHex, state.roundId)] ?? null) : null
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
        <nav className="views" aria-label="View">
          <button aria-pressed={route.view === 'play'} onClick={() => goTo({ view: 'play' })}>
            Play
          </button>
          <button aria-pressed={route.view === 'verify'} onClick={() => goTo({ view: 'verify', round: null })}>
            Verify
          </button>
        </nav>
      </header>

      <div className="layout">
        <figure className="board">
          <PachinkoCanvas config={CONFIG} balls={balls} />
          <figcaption>
            <strong>{state.roundId === null ? 'The board' : `Round #${state.roundId}`}</strong> · simulated in your
            browser from the round's seed. On-chain seeds come from Sui randomness, so nobody can pick them, and the
            operator must report exactly what the board shows.
          </figcaption>
        </figure>

        <aside className="side">
          <div className="side" hidden={route.view !== 'play'}>
            <AuthPanel state={authState} {...authActions} />
            <OnchainPanel onSeed={playReplay} onClaim={reportClaim} />
          </div>
          {route.view === 'verify' &&
            (verify ? (
              <VerifyPanel
                deployment={verify.deployment}
                client={verify.client}
                initialRound={route.round}
                onRoundChange={(round) => showRoute({ view: 'verify', round })}
                playOnBoard={playReplay}
                onClaim={reportClaim}
                boardBusy={status === 'simulating' || status === 'playing'}
              />
            ) : (
              <section className="verify-panel off">{!ONCHAIN.enabled && ONCHAIN.reason}</section>
            ))}
          <ResultPanel
            config={CONFIG}
            status={status}
            tally={tally}
            seedHex={state.seedHex}
            roundId={state.roundId}
            resultHash={status === 'done' ? (result?.resultHash ?? null) : null}
            operatorOutcomes={status === 'done' ? claim : null}
            error={state.error}
          />
          {route.view === 'verify' && (
            <details className="replay-any">
              <summary>Advanced: replay any seed</summary>
              <SeedInput onReplay={playSeed} disabled={isBusy} />
            </details>
          )}
        </aside>
      </div>
    </main>
  )
}

export default App
