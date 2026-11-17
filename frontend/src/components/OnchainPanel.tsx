/**
 * On-chain play: connect a Sui wallet, bet with one signature, and follow the round on testnet.
 * The operator (physics-service) draws the seed, submits and finalizes; once the seed is on-chain,
 * `onSeed` plays it with the normal board animation. Off unless a deployment is configured.
 */
import { useCurrentAccount } from '@mysten/dapp-kit-react'
import { TESTNET_EXPLORER_OBJECT, TESTNET_EXPLORER_TX, type Deployment } from '@pachinko/chain'
import { BET_MIST, useOnchainRound, type OnchainPhase } from '../hooks/useOnchainRound'
import { ONCHAIN } from '../onchain/deployment'
import { getDAppKit } from '../onchain/dappKit'
import { WalletPanel } from './WalletPanel'
import './OnchainPanel.css'

interface Props {
  /** Plays a round on the board from its seed. */
  readonly onSeed: (seedHex: string, roundId: bigint) => void
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
  const { state, play } = useOnchainRound(deployment, dAppKit, onSeed)
  const busy = BUSY.includes(state.phase)

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
