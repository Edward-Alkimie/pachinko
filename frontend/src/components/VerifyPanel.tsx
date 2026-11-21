/**
 * Verify page: anyone checks any round of the deployment from the chain alone. Enter a round
 * number; the page reads the round and its events, replays the seed in this browser, and shows
 * whether what was submitted and what was paid match that replay, plus the challenge history
 * (committee votes, verdict). The round then plays on the board by itself, unless the board is busy
 * with another round (e.g. an on-chain round on the Play view); "Watch again" plays it any time.
 * Link: `#verify/<round>`.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { toHex } from '@mysten/sui/utils'
import {
  RoundStatus,
  TESTNET_EXPLORER_ACCOUNT,
  TESTNET_EXPLORER_OBJECT,
  type Deployment,
} from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { useVerifyRound, type VerifiedRound } from '../hooks/useVerifyRound'
import { checkRoundId } from '../lib/validation'
import { paidHash, verdictOf, type Verdict } from '../onchain/verify'
import './VerifyPanel.css'

interface Props {
  readonly deployment: Deployment
  readonly client: ClientWithCoreApi
  /** Round to verify on open (from the link), or null. */
  readonly initialRound: bigint | null
  /** Called with each round verified, so the link can follow. */
  readonly onRoundChange: (roundId: bigint) => void
  /** Plays a round on the board. */
  readonly onWatch: (seedHex: string, roundId: bigint) => void
  /** The board is playing another round: don't take it over without a click. */
  readonly boardBusy: boolean
}

const VERDICT_TEXT: Record<Verdict, string> = {
  verified: '✓ Verified: the player was paid from exactly the result your browser computes.',
  caught: '✓ A forged result was challenged and overturned; the player was paid from the result your browser computes.',
  upheld: '✓ A challenge failed (the operator was honest); the player was paid from the result your browser computes.',
  paidMismatch: '✗ The player was paid from a result your browser does NOT compute.',
  refunded: 'No result arrived in time, so the bet was refunded.',
  inProgress: 'This round is not settled yet.',
}

const STATUS_NAME: Record<RoundStatus, string> = {
  [RoundStatus.BetLocked]: 'bet locked',
  [RoundStatus.Seeded]: 'seeded',
  [RoundStatus.Submitted]: 'result submitted',
  [RoundStatus.Challenged]: 'challenged',
  [RoundStatus.Finalized]: 'final',
  [RoundStatus.Refunded]: 'refunded',
}

const sui = (mist: bigint | string) => `${Number(mist) / 1e9} SUI`
const short = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-4)}`
const hashOf = (bytes: number[]) => toHex(Uint8Array.from(bytes))

export function VerifyPanel({ deployment, client, initialRound, onRoundChange, onWatch, boardBusy }: Props) {
  const { state, verify } = useVerifyRound(deployment, client)
  // The verified result the board was last given, so each result plays by itself only once.
  const played = useRef<VerifiedRound | null>(null)
  const [input, setInput] = useState(initialRound?.toString() ?? '')
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    if (initialRound !== null) void verify(initialRound)
  }, [initialRound, verify])

  useEffect(() => {
    if (state.status !== 'done' || played.current === state.result || boardBusy) return
    played.current = state.result
    const { seedHex, round } = state.result
    if (seedHex) onWatch(seedHex, round.roundId)
  }, [state, boardBusy, onWatch])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const problem = checkRoundId(input)
    setInputError(problem)
    if (problem !== null) return
    const roundId = BigInt(input.trim())
    onRoundChange(roundId)
    void verify(roundId)
  }

  return (
    <section className="verify-panel" aria-label="Verify a round">
      <form onSubmit={submit}>
        <label>
          Round #
          <input value={input} onChange={(e) => setInput(e.target.value)} inputMode="numeric" />
        </label>
        <button type="submit" disabled={state.status === 'loading'}>
          Verify
        </button>
      </form>
      {inputError && <p className="error">{inputError}</p>}
      {state.status === 'idle' && <p className="hint">Check any round from the chain alone: no trust in the operator.</p>}
      {state.status === 'loading' && <p className="hint">Reading round #{state.roundId.toString()} from the chain…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'done' && <Report result={state.result} onWatch={onWatch} />}
    </section>
  )
}

function Report({ result, onWatch }: { result: VerifiedRound; onWatch: Props['onWatch'] }) {
  const { round, betMist, seedHex, replayHash, history } = result
  const paid = paidHash(history)
  const submitted = history.submitted ? hashOf(history.submitted.result_hash) : null
  const verdict = replayHash ? verdictOf(round.status, history, replayHash) : null

  return (
    <div className="report">
      {verdict && <p className={`verdict ${verdict}`}>{VERDICT_TEXT[verdict]}</p>}
      {!verdict && round.seed && (
        <p className="hint">
          This round uses physics {round.configVersion}; this page runs {DEFAULT_CONFIG.version}, so it can't replay it.
        </p>
      )}
      <dl>
        <dt>Round</dt>
        <dd>
          <a href={`${TESTNET_EXPLORER_OBJECT}/${round.objectId}`} target="_blank" rel="noreferrer">
            #{round.roundId.toString()}
          </a>{' '}
          · {STATUS_NAME[round.status]}
        </dd>
        <dt>Bet</dt>
        <dd>{sui(betMist)}</dd>
        <dt>Player</dt>
        <dd className="mono">
          <a href={`${TESTNET_EXPLORER_ACCOUNT}/${round.player}`} target="_blank" rel="noreferrer">
            {short(round.player)}
          </a>
        </dd>
        <dt>Seed</dt>
        <dd className="mono" title={seedHex ?? undefined}>{seedHex ? short(seedHex) : 'not drawn yet'}</dd>
        {replayHash && (
          <>
            <dt>Your replay</dt>
            <dd className="mono" title={replayHash}>{short(replayHash)}</dd>
          </>
        )}
        {submitted && <HashRow label="Submitted" hash={submitted} replayHash={replayHash} />}
        {paid && <HashRow label="Paid from" hash={paid} replayHash={replayHash} />}
        {history.challenged && (
          <>
            <dt>Challenged by</dt>
            <dd className="mono">{short(history.challenged.challenger)}</dd>
          </>
        )}
        {history.committee && (
          <>
            <dt>Committee</dt>
            <dd>
              <ul className="committee">
                {history.committee.committee.map((member) => {
                  const vote = history.votes.find((v) => v.voter === member)
                  const voteHash = vote ? hashOf(vote.result_hash) : null
                  const agrees = voteHash !== null && voteHash === replayHash
                  return (
                    <li key={member} className={vote ? (agrees ? 'agrees' : 'disagrees') : 'waiting'}>
                      <span className="mono">{short(member)}</span>{' '}
                      {vote ? (agrees ? 'voted ✓ your replay' : 'voted ✗ another result') : 'no vote'}
                    </li>
                  )
                })}
              </ul>
            </dd>
          </>
        )}
        {history.resolved && (
          <>
            <dt>Verdict</dt>
            <dd>
              {history.resolved.operator_honest ? 'operator honest' : 'operator forged the result'} (
              {history.resolved.by_committee ? 'committee' : 'admin fallback'}); {sui(history.resolved.award)} →{' '}
              <span className="mono">{short(history.resolved.winner)}</span>
            </dd>
          </>
        )}
        {history.finalized && (
          <>
            <dt>Payout</dt>
            <dd>{sui(history.finalized.payout)}</dd>
          </>
        )}
        {history.refunded && (
          <>
            <dt>Refunded</dt>
            <dd>{sui(history.refunded.amount)}</dd>
          </>
        )}
      </dl>
      {seedHex && (
        <button type="button" onClick={() => onWatch(seedHex, round.roundId)}>
          Watch again
        </button>
      )}
    </div>
  )
}

function HashRow({ label, hash, replayHash }: { label: string; hash: string; replayHash: string | null }) {
  const mark = replayHash === null ? '' : hash === replayHash ? ' ✓' : ' ✗'
  return (
    <>
      <dt>{label}</dt>
      <dd className={`mono ${mark === ' ✓' ? 'match' : mark === ' ✗' ? 'mismatch' : ''}`} title={hash}>
        {short(hash)}
        {mark}
      </dd>
    </>
  )
}
