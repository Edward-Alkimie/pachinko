/**
 * On-chain play: connect a Sui wallet, bet with one signature, and follow the round on testnet.
 * The operator (physics-service) draws the seed, submits and finalizes; once the seed is on-chain,
 * `onSeed` plays it with the normal board animation. When the result is submitted, the panel
 * compares it with the page's own replay; on a mismatch the player can challenge inside the window,
 * and the verdict is shown once the arbiter settles it. Off unless a deployment is configured.
 */
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { TESTNET_EXPLORER_OBJECT, TESTNET_EXPLORER_TX, type Deployment } from '@pachinko/chain'
import { BET_MIST, replayCheck, useOnchainRound, type OnchainPhase, type ReplayCheck } from '../hooks/useOnchainRound'
import { ONCHAIN } from '../onchain/deployment'
import { getDAppKit } from '../onchain/dappKit'
import { WalletPanel } from './WalletPanel'
import './OnchainPanel.css'

interface Props {
  /** Plays a round on the board from its seed; resolves with the replay's result hash. */
  readonly onSeed: (seedHex: string, roundId: bigint) => Promise<string | null>
}

const PHASE_TEXT: Record<OnchainPhase, string> = {
  idle: 'Bet and play a round on Sui testnet.',
  signing: 'Confirm the bet in your wallet…',
  waitingSeed: 'Bet locked. Waiting for the on-chain seed…',
  verifying: 'Result submitted. Challenge window open…',
  challenged: 'Result challenged. Waiting for the arbiter…',
  final: 'Round final. Paid out.',
  error: 'Something went wrong.',
}

const BUSY: readonly OnchainPhase[] = ['signing', 'waitingSeed', 'verifying', 'challenged']

const CHECK_TEXT: Record<Exclude<ReplayCheck, null>, string> = {
  pending: 'Checking your replay against the submitted result…',
  match: '✓ Your replay matches the submitted result.',
  mismatch: '✗ Your replay does not match the submitted result.',
}

function sui(mist: bigint): string {
  return `${Number(mist) / 1e9} SUI`
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
  const { state, play, challenge } = useOnchainRound(deployment, dAppKit, onSeed)
  const busy = BUSY.includes(state.phase)
  const check = replayCheck(state)
  const bondMist = BigInt(deployment.house.challengerBondMist)
  const windowOpen = state.deadlineMs !== null && Date.now() < state.deadlineMs
  const canChallenge = check === 'mismatch' && state.phase === 'verifying' && !state.challengeDigest

  return (
    <section className="onchain-panel" aria-label="On-chain play">
      <p className="deployment">Sui testnet · deployment {name}</p>
      <WalletPanel dAppKit={dAppKit} />
      <button className="start" onClick={() => void play()} disabled={!account || busy}>
        Play on-chain ({sui(BET_MIST)})
      </button>
      <p className="status" aria-live="polite">
        {state.error ?? PHASE_TEXT[state.phase]}
      </p>
      {check && <p className={`check ${check}`}>{CHECK_TEXT[check]}</p>}
      {canChallenge && (
        <button
          className="challenge"
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
          {state.deadlineMs !== null && state.phase === 'verifying' && (
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
          {state.resolution && (
            <>
              <dt>Verdict</dt>
              <dd>
                {state.resolution.operatorHonest ? 'Operator honest' : 'Operator forged the result'}; bonds{' '}
                {sui(state.resolution.awardMist)} →{' '}
                {state.resolution.winner === account?.address ? 'you' : `${state.resolution.winner.slice(0, 8)}…`}
              </dd>
            </>
          )}
          {state.payoutMist !== null && (
            <>
              <dt>Payout</dt>
              <dd>
                <strong>{sui(state.payoutMist)}</strong> (bet {sui(BET_MIST)})
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  )
}
