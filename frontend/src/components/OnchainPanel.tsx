/**
 * On-chain play: connect a Sui wallet, bet with one signature, and follow the round on testnet.
 * The operator (physics-service) draws the seed, submits and finalizes; once the seed is on-chain,
 * `onSeed` plays it with the normal board animation. Nothing from the chain is shown while the balls
 * are still falling (`stageOf`). After that the panel compares the submitted result with the page's
 * own replay (worded as "this page's replay", with the `npm run replay` command for a check that does
 * not trust the page). Both hashes are shown (`ResultHashes`): the operator's as soon as it is on-chain,
 * the replay's once the balls land, and the player may challenge while the window is open (anyone may; on a match the
 * warning says the bond would be lost). A challenged round shows its committee and their votes, and keeps them on screen once the round
 * is final (with the deciding vote); the verdict and the wallet's net show once the round is final. If the operator misses the round's submit
 * deadline, the player can take the bet back. Off unless a deployment is configured.
 */
import { useEffect, useState } from 'react'
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { TESTNET_EXPLORER_OBJECT, TESTNET_EXPLORER_TX, type Deployment } from '@pachinko/chain'
import {
  BET_MIST,
  canRefund,
  committeeVotes,
  replayCheck,
  settledCheck,
  stageOf,
  useOnchainRound,
  type CommitteeVote,
  type OnchainStage,
  type SettledCheck,
} from '../hooks/useOnchainRound'
import { ONCHAIN } from '../onchain/deployment'
import { settlement } from '../onchain/settlement'
import { getDAppKit } from '../onchain/dappKit'
import { ReplayCommand } from './CopyValue'
import { ResultHashes } from './ResultHashes'
import { RoundSteps } from './RoundSteps'
import { WalletPanel } from './WalletPanel'
import './OnchainPanel.css'

interface Props {
  /** Plays a round on the board from its seed; resolves with the replay's result hash. */
  readonly onSeed: (seedHex: string, roundId: bigint) => Promise<string | null>
  /** Passes on the operator's claimed outcomes once they are on-chain (shown next to the board's counts). */
  readonly onClaim: (seedHex: string, roundId: bigint, outcomes: readonly number[]) => void
}

const STAGE_TEXT: Record<OnchainStage, string> = {
  idle: 'Bet, and the round plays on the board. The operator then reports the result, and you check it against the board.',
  signing: 'Confirm the bet in your wallet…',
  waitingSeed: 'Bet locked. Waiting for Sui to draw the random seed…',
  playing: 'Seed drawn on-chain. Your round is playing on the board…',
  waitingResult: 'Waiting for the operator to report the result…',
  verifying: 'The operator reported its result. Anyone may challenge it until the window closes.',
  challenged: 'Challenged. A committee of 3 staked verifiers re-runs the seed and votes.',
  final: 'Round final.',
  refunded: 'The operator sent no result in time, so your bet was refunded.',
  error: 'Something went wrong.',
}

const VOTE_TEXT: Record<CommitteeVote, string> = {
  waiting: 'waiting for its vote…',
  agrees: 'voted ✓ same result as the board',
  disagrees: 'voted ✗ a different result',
}

const IDLE: readonly OnchainStage[] = ['idle', 'final', 'refunded', 'error']

const CHECK_TEXT: Record<Exclude<SettledCheck, null>, string> = {
  match: "✓ The operator's result matches the board.",
  mismatch: "✗ The operator's result does not match the board.",
  unavailable: "The board was given another round before the balls landed, so the operator's result was not checked.",
  paid: "✓ The operator's result matches the board, and the round paid out on it.",
  unchallenged:
    "✗ The operator's result did not match the board, but nobody challenged it before the window closed, so the round paid out on the operator's result.",
  overturned:
    "✓ Resolved: the operator's result did not match the board, and the committee overturned it. You were paid on the board's result.",
  upheld: "✓ Resolved: the committee upheld the operator's result, which matches the board.",
}

function sui(mist: bigint): string {
  return `${Number(mist) / 1e9} SUI`
}

/** `+0.01 SUI` / `−0.01 SUI` (a zero shows as `0 SUI`). */
function signedSui(mist: bigint): string {
  if (mist === 0n) return sui(0n)
  return mist > 0n ? `+${sui(mist)}` : `−${sui(-mist)}`
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString()
}

export function OnchainPanel({ onSeed, onClaim }: Props) {
  if (!ONCHAIN.enabled) {
    return <section className="onchain-panel off">{ONCHAIN.reason}</section>
  }
  return <ConnectedPanel name={ONCHAIN.name} deployment={ONCHAIN.deployment} onSeed={onSeed} onClaim={onClaim} />
}

function ConnectedPanel({ name, deployment, onSeed, onClaim }: Props & { name: string; deployment: Deployment }) {
  const dAppKit = getDAppKit()
  const account = useCurrentAccount({ dAppKit })
  const { state, play, challenge, refund, replayAgain } = useOnchainRound(deployment, dAppKit, onSeed)
  const { seedHex, roundId, submittedOutcomes } = state
  useEffect(() => {
    if (seedHex && roundId !== null && submittedOutcomes) onClaim(seedHex, roundId, submittedOutcomes)
  }, [seedHex, roundId, submittedOutcomes, onClaim])
  const stage = stageOf(state)
  const busy = !IDLE.includes(stage)
  // Chain results stay hidden while the board is playing (stage 'playing').
  const check = stage === 'playing' ? null : replayCheck(state)
  // Once the round is final, the check says what paid out (no lingering ✗ after an overturn).
  const shownCheck = settledCheck(check, stage === 'final', state.resolution)
  const bondMist = BigInt(deployment.house.challengerBondMist)
  // A one-second clock while the challenge window runs, for the countdown.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (stage !== 'verifying') return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [stage])
  const windowOpen = state.deadlineMs !== null && now < state.deadlineMs
  const secondsLeft = state.deadlineMs === null ? 0 : Math.max(0, Math.ceil((state.deadlineMs - now) / 1_000))
  // Anyone may challenge while the window is open; the check only tells the player how risky it is.
  const showChallenge = stage === 'verifying' && !state.challengeDigest
  const refundable = stage === 'waitingResult' && canRefund(state, Date.now())
  const finished = stage === 'final' || stage === 'refunded'
  const result = finished ? settlement(state, account?.address ?? null, BET_MIST, bondMist) : null

  return (
    <section className="onchain-panel" aria-label="On-chain play">
      <p className="deployment">Sui testnet · deployment {name}</p>
      <WalletPanel dAppKit={dAppKit} />
      <button className="start" onClick={() => void play()} disabled={!account || busy}>
        Play on-chain ({sui(BET_MIST)})
      </button>
      <RoundSteps stage={stage} challenged={state.dispute !== null || state.resolution !== null} />
      <p className="status" aria-live="polite">
        {state.error ?? STAGE_TEXT[stage]}
      </p>
      {shownCheck && <p className={`check ${shownCheck}`}>{CHECK_TEXT[shownCheck]}</p>}
      {state.submittedHash && (
        <ResultHashes
          submittedHash={state.submittedHash}
          replay={state.replay}
          replayHash={state.replayHash}
          paidHash={stage === 'final' ? state.paidHash : null}
        />
      )}
      {check === 'unavailable' && <button onClick={replayAgain}>Replay this round to check it</button>}
      {shownCheck && state.seedHex && state.roundId !== null && (
        <ReplayCommand
          intro="Don't want to trust this page's board? Check it yourself:"
          seedHex={state.seedHex}
          roundId={state.roundId}
        />
      )}
      {showChallenge && (
        <button
          className={check === 'mismatch' ? 'challenge' : 'challenge secondary'}
          onClick={() => void challenge()}
          disabled={!account || state.walletAction !== null || !windowOpen}
        >
          {state.walletAction === 'challenge'
            ? 'Confirm the challenge in your wallet…'
            : windowOpen
              ? `Challenge (${sui(bondMist)} bond) · ${secondsLeft} s left`
              : 'Challenge window closed'}
        </button>
      )}
      {showChallenge && check === 'mismatch' && windowOpen && state.deadlineMs !== null && (
        <p className="hint">
          Challenge and a committee of 3 verifiers re-runs the seed. If they agree with the board, the result is
          corrected and you win the operator's bond. If nobody challenges, the round pays out on the operator's result.
        </p>
      )}
      {showChallenge && check === 'match' && windowOpen && (
        <p className="hint">Anyone can challenge, but the operator's result matches the board: a challenge would lose the bond.</p>
      )}
      {stage === 'waitingResult' && state.submitDeadlineMs > 0 && !refundable && (
        <p className="hint">If no result arrives by {clockTime(state.submitDeadlineMs)}, you can take your bet back.</p>
      )}
      {refundable && (
        <button className="challenge" onClick={() => void refund()} disabled={!account || state.walletAction !== null}>
          {state.walletAction === 'refund'
            ? 'Confirm the refund in your wallet…'
            : `The operator missed its deadline: refund my bet (${sui(BET_MIST)})`}
        </button>
      )}
      {(stage === 'challenged' || stage === 'final') && state.dispute && (
        <div className="committee" role="group" aria-label="Committee votes">
          <p className="committee-title">Committee votes</p>
          {state.dispute.committee.length === 0 ? (
            <p className="hint">Drawing 3 verifiers at random…</p>
          ) : (
            <ul>
              {committeeVotes(state.dispute, state.replayHash).map(({ verifier, vote }) => (
                <li key={verifier} className={vote}>
                  <span className="mono">{shortAddress(verifier)}</span>{' '}
                  {vote === 'waiting' && stage === 'final' ? 'did not vote' : VOTE_TEXT[vote]}
                </li>
              ))}
            </ul>
          )}
          <p className="hint">
            {stage === 'final'
              ? 'Voting closed: these votes decided the round (verdict below).'
              : `2 matching votes decide. Voting ends ${clockTime(state.dispute.deadlineMs)}.`}
          </p>
        </div>
      )}
      {state.actionError && <p className="error">{state.actionError}</p>}
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
          {state.refundDigest && (
            <>
              <dt>Refund tx</dt>
              <dd className="mono">
                <a href={`${TESTNET_EXPLORER_TX}/${state.refundDigest}`} target="_blank" rel="noreferrer">
                  {state.refundDigest.slice(0, 10)}…
                </a>
              </dd>
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
                {state.resolution.operatorHonest ? 'Operator honest' : 'Operator forged the result'}
                {state.resolution.byCommittee ? ' (by the committee)' : ' (by the admin fallback)'};{' '}
                {sui(state.resolution.awardMist)} →{' '}
                {state.resolution.winner === account?.address ? 'you' : shortAddress(state.resolution.winner)}
              </dd>
            </>
          )}
        </dl>
      )}
      {result && <p className="section-title">Your wallet this round</p>}
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
