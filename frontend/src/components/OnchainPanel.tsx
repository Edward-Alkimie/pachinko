/**
 * On-chain play: connect a Sui wallet, bet with one signature, and follow the round on testnet.
 * The operator (physics-service) draws the seed, submits and finalizes; once the seed is on-chain,
 * `onSeed` plays it with the normal board animation. Nothing from the chain is shown while the balls
 * are still falling (`stageOf`). After that the panel compares the submitted result with the page's
 * own replay, and the player may challenge while the window is open (anyone may; on a match the
 * warning says the bond would be lost). The verdict and the wallet's net show once the round is final.
 * Off unless a deployment is configured.
 */
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { TESTNET_EXPLORER_OBJECT, TESTNET_EXPLORER_TX, type Deployment } from '@pachinko/chain'
import {
  BET_MIST,
  replayCheck,
  stageOf,
  useOnchainRound,
  type OnchainStage,
  type ReplayCheck,
} from '../hooks/useOnchainRound'
import { ONCHAIN } from '../onchain/deployment'
import { settlement } from '../onchain/settlement'
import { getDAppKit } from '../onchain/dappKit'
import { WalletPanel } from './WalletPanel'
import './OnchainPanel.css'

interface Props {
  /** Plays a round on the board from its seed; resolves with the replay's result hash. */
  readonly onSeed: (seedHex: string, roundId: bigint) => Promise<string | null>
}

const STAGE_TEXT: Record<OnchainStage, string> = {
  idle: 'Bet and play a round on Sui testnet.',
  signing: 'Confirm the bet in your wallet…',
  waitingSeed: 'Bet locked. Waiting for the on-chain seed…',
  playing: 'Seed drawn on-chain. Playing your round…',
  waitingResult: "Waiting for the operator's result…",
  verifying: 'Result submitted. Challenge window open.',
  challenged: 'Result challenged. Waiting for the arbiter…',
  final: 'Round final. What it did to your wallet:',
  error: 'Something went wrong.',
}

const IDLE: readonly OnchainStage[] = ['idle', 'final', 'error']

const CHECK_TEXT: Record<Exclude<ReplayCheck, null>, string> = {
  match: '✓ Your replay matches the submitted result.',
  mismatch: '✗ Your replay does not match the submitted result.',
  unavailable: 'Your replay was interrupted by another seed, so it was not checked.',
}

function sui(mist: bigint): string {
  return `${Number(mist) / 1e9} SUI`
}

/** `+0.01 SUI` / `−0.01 SUI` (a zero shows as `0 SUI`). */
function signedSui(mist: bigint): string {
  if (mist === 0n) return sui(0n)
  return mist > 0n ? `+${sui(mist)}` : `−${sui(-mist)}`
}

export function OnchainPanel({ onSeed }: Props) {
  if (!ONCHAIN.enabled) {
    return <section className="onchain-panel off">{ONCHAIN.reason}</section>
  }
  return <ConnectedPanel name={ONCHAIN.name} deployment={ONCHAIN.deployment} onSeed={onSeed} />
}

function ConnectedPanel({ name, deployment, onSeed }: Props & { name: string; deployment: Deployment }) {
  const dAppKit = getDAppKit()
  const account = useCurrentAccount({ dAppKit })
  const { state, play, challenge, replayAgain } = useOnchainRound(deployment, dAppKit, onSeed)
  const stage = stageOf(state)
  const busy = !IDLE.includes(stage)
  // Chain results stay hidden while the board is playing (stage 'playing').
  const check = stage === 'playing' ? null : replayCheck(state)
  const bondMist = BigInt(deployment.house.challengerBondMist)
  const windowOpen = state.deadlineMs !== null && Date.now() < state.deadlineMs
  // Anyone may challenge while the window is open; the check only tells the player how risky it is.
  const showChallenge = stage === 'verifying' && !state.challengeDigest
  const result = stage === 'final' ? settlement(state, account?.address ?? null, BET_MIST, bondMist) : null

  return (
    <section className="onchain-panel" aria-label="On-chain play">
      <p className="deployment">Sui testnet · deployment {name}</p>
      <WalletPanel dAppKit={dAppKit} />
      <button className="start" onClick={() => void play()} disabled={!account || busy}>
        Play on-chain ({sui(BET_MIST)})
      </button>
      <p className="status" aria-live="polite">
        {state.error ?? STAGE_TEXT[stage]}
      </p>
      {check && <p className={`check ${check}`}>{CHECK_TEXT[check]}</p>}
      {check === 'unavailable' && <button onClick={replayAgain}>Replay this round to check it</button>}
      {showChallenge && (
        <button
          className={check === 'mismatch' ? 'challenge' : 'challenge secondary'}
          onClick={() => void challenge()}
          disabled={!account || state.challenging || !windowOpen}
        >
          {state.challenging
            ? 'Confirm the challenge in your wallet…'
            : windowOpen
              ? `Challenge (${sui(bondMist)} bond)`
              : 'Challenge window closed'}
        </button>
      )}
      {showChallenge && check === 'match' && windowOpen && (
        <p className="hint">Anyone can challenge, but the result matches your replay: a challenge would lose the bond.</p>
      )}
      {state.challengeError && <p className="error">{state.challengeError}</p>}
      {state.roundObjectId && (
        <dl className="round-info">
          <dt>Round</dt>
          <dd>
            <a href={`${TESTNET_EXPLORER_OBJECT}/${state.roundObjectId}`} target="_blank" rel="noreferrer">
              #{state.roundId?.toString()}
            </a>
          </dd>
          {state.createDigest && (
            <>
              <dt>Bet tx</dt>
              <dd className="mono">
                <a href={`${TESTNET_EXPLORER_TX}/${state.createDigest}`} target="_blank" rel="noreferrer">
                  {state.createDigest.slice(0, 10)}…
                </a>
              </dd>
            </>
          )}
          {state.deadlineMs !== null && stage === 'verifying' && (
            <>
              <dt>Window ends</dt>
              <dd>{new Date(state.deadlineMs).toLocaleTimeString()}</dd>
            </>
          )}
          {state.challengeDigest && (
            <>
              <dt>Challenge tx</dt>
              <dd className="mono">
                <a href={`${TESTNET_EXPLORER_TX}/${state.challengeDigest}`} target="_blank" rel="noreferrer">
                  {state.challengeDigest.slice(0, 10)}…
                </a>
              </dd>
            </>
          )}
          {state.resolution && stage === 'final' && (
            <>
              <dt>Verdict</dt>
              <dd>
                {state.resolution.operatorHonest ? 'Operator honest' : 'Operator forged the result'}; bonds{' '}
                {sui(state.resolution.awardMist)} →{' '}
                {state.resolution.winner === account?.address ? 'you' : `${state.resolution.winner.slice(0, 8)}…`}
              </dd>
            </>
          )}
        </dl>
      )}
      {result && (
        <table className="settlement" aria-label="Your wallet this round">
          <tbody>
            {result.lines.map((line) => (
              <tr key={line.label}>
                <th scope="row">{line.label}</th>
                <td>{signedSui(line.mist)}</td>
              </tr>
            ))}
            <tr className={`net ${result.netMist < 0n ? 'loss' : 'gain'}`}>
              <th scope="row">Net</th>
              <td>{signedSui(result.netMist)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  )
}
