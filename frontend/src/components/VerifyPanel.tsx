/**
 * Verify page: look up any round of the deployment on the chain and check it by watching it. Enter a round
 * number; the page shows what the chain records (seed, submitted and paid result hashes, the challenge
 * history with committee votes and verdict, payout or refund) and plays the round on the board. When the
 * balls land, the replay's hash is the check: each hash gets ✓/✗ and the summary verdict appears. If the
 * board is busy with another round, it waits for a "Replay on the board" click (which would stop that
 * round). `npm run replay` checks the same round without trusting this website. Link: `#verify/<round>`.
 */
import { useEffect, useState, type FormEvent } from 'react'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { toHex } from '@mysten/sui/utils'
import {
  RoundStatus,
  TESTNET_EXPLORER_ACCOUNT,
  TESTNET_EXPLORER_OBJECT,
  type Deployment,
} from '@pachinko/chain'
import { DEFAULT_CONFIG } from '@pachinko/physics'
import { useVerifyRound, type BoardReplay, type VerifiedRound } from '../hooks/useVerifyRound'
import { checkRoundId } from '../lib/validation'
import { paidHash, verdictOf, type Verdict } from '../onchain/verify'
import { shortHex } from '../lib/hex'
import { CopyValue, ReplayCommand } from './CopyValue'
import './VerifyPanel.css'

interface Props {
  readonly deployment: Deployment
  readonly client: ClientWithCoreApi
  /** Round to verify on open (from the link), or null. */
  readonly initialRound: bigint | null
  /** Called with each round verified, so the link can follow. */
  readonly onRoundChange: (roundId: bigint) => void
  /** Plays a round on the board; resolves with the replay's result hash once the balls land (null if cut short). */
  readonly playOnBoard: (seedHex: string, roundId: bigint) => Promise<string | null>
  /** The board is playing a round: don't take it over without a click. */
  readonly boardBusy: boolean
}

const VERDICT_TEXT: Record<Verdict, string> = {
  verified: "✓ Verified: the player was paid from exactly the result of the replay you just watched.",
  caught: '✓ A forged result was challenged and overturned; the player was paid from the result of the replay you just watched.',
  upheld: '✓ A challenge failed (the operator was honest); the player was paid from the result of the replay you just watched.',
  unchallenged:
    "✗ The operator's result does not match the replay you just watched, but nobody challenged it in time, so the player was paid from the wrong result.",
  paidMismatch: '✗ The player was paid from a result the replay you just watched does NOT give, even after a challenge.',
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
const hashOf = (bytes: number[]) => toHex(Uint8Array.from(bytes))

export function VerifyPanel({ deployment, client, initialRound, onRoundChange, playOnBoard, boardBusy }: Props) {
  const { state, verify, replayOnBoard, ownReplayPlaying } = useVerifyRound(deployment, client, playOnBoard)
  // Busy with someone else's round (e.g. an on-chain round from the Play view), not an earlier Verify replay.
  const boardTaken = boardBusy && !ownReplayPlaying
  const [input, setInput] = useState(initialRound?.toString() ?? '')
  const [inputError, setInputError] = useState<string | null>(null)

  useEffect(() => {
    if (initialRound !== null) void verify(initialRound)
  }, [initialRound, verify])

  // Each verified round plays on the board by itself (that replay is the check), unless the board is busy.
  const autoReplay = state.status === 'done' && state.replay === 'none' && state.result.canReplay && !boardTaken
  useEffect(() => {
    if (autoReplay) void replayOnBoard()
  }, [autoReplay, replayOnBoard])

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
      {state.status === 'idle' && <p className="hint">Look up any round on the chain and watch it replay on the board.</p>}
      {state.status === 'loading' && <p className="hint">Reading round #{state.roundId.toString()} from the chain…</p>}
      {state.status === 'error' && <p className="error">{state.error}</p>}
      {state.status === 'done' && (
        <Report
          result={state.result}
          replay={state.replay}
          onReplay={() => void replayOnBoard()}
          boardBusy={boardTaken}
        />
      )}
    </section>
  )
}

interface ReportProps extends Pick<Props, 'boardBusy'> {
  readonly result: VerifiedRound
  readonly replay: BoardReplay
  readonly onReplay: () => void
}

function Report({ result, replay, onReplay, boardBusy }: ReportProps) {
  const { round, betMist, seedHex, canReplay, replayHash, history } = result
  const paid = paidHash(history)
  const submitted = history.submitted ? hashOf(history.submitted.result_hash) : null
  const verdict = replayHash ? verdictOf(round.status, history, replayHash) : null

  return (
    <div className="report">
      {verdict && <p className={`verdict ${verdict}`}>{VERDICT_TEXT[verdict]}</p>}
      {!verdict && <p className="hint">{waitingText(result, replay, boardBusy)}</p>}
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
            {shortHex(round.player)}
          </a>
        </dd>
        <dt>Seed</dt>
        {seedHex ? <CopyValue label="seed" value={seedHex} /> : <dd>not drawn yet</dd>}
        {replayHash && (
          <>
            <dt>This page's replay</dt>
            <CopyValue label="this page's replay hash" value={replayHash} />
          </>
        )}
        {submitted && <HashRow label="Operator submitted" hash={submitted} replayHash={replayHash} />}
        {paid && <HashRow label="Payout used" hash={paid} replayHash={replayHash} />}
        {history.challenged && (
          <>
            <dt>Challenged by</dt>
            <dd className="mono">{shortHex(history.challenged.challenger)}</dd>
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
                  return (
                    <li key={member} className={voteClass(voteHash, replayHash)}>
                      <span className="mono">{shortHex(member)}</span> {voteText(voteHash, replayHash, submitted)}
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
              <span className="mono">{shortHex(history.resolved.winner)}</span>
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
      {(replayHash || submitted || paid) && (
        <p className="hint">
          Each hash is a fingerprint (SHA-256) of where the round's 100 balls landed.
          {replayHash && " ✓ = same as this page's replay, ✗ = different."}
        </p>
      )}
      {seedHex && canReplay && (
        <div className="replay">
          <button type="button" onClick={onReplay} disabled={replay === 'playing'}>
            {replay === 'playing' ? 'Replaying…' : 'Replay on the board'}
          </button>
          {boardBusy && replay !== 'playing' && (
            <span className="hint">The board is playing another round: replaying stops it.</span>
          )}
        </div>
      )}
      {seedHex && (
        <ReplayCommand intro="Check it without trusting this website:" seedHex={seedHex} roundId={round.roundId} />
      )}
    </div>
  )
}

/** What the page says while it has no replay hash yet. */
function waitingText(result: VerifiedRound, replay: BoardReplay, boardBusy: boolean): string {
  const { round, seedHex, canReplay } = result
  if (seedHex === null) return 'The seed is not drawn yet, so there is nothing to replay.'
  if (!canReplay) {
    return `This round uses physics ${round.configVersion}; this page runs ${DEFAULT_CONFIG.version}, so it can't replay it.`
  }
  if (replay === 'playing') return 'Replaying the round on the board… the check appears when the balls land.'
  if (replay === 'interrupted') return 'The replay was stopped before the balls landed, so it was not checked.'
  if (boardBusy) return 'The board is busy with another round. Replay this one on the board to check it.'
  return 'This is what the chain records.'
}

function HashRow({ label, hash, replayHash }: { label: string; hash: string; replayHash: string | null }) {
  const match = replayHash === null ? null : hash === replayHash
  return (
    <>
      <dt>{label}</dt>
      <CopyValue
        label={`${label.toLowerCase()} hash`}
        value={hash}
        className={match === null ? '' : match ? 'match' : 'mismatch'}
        mark={match === null ? undefined : match ? '✓' : '✗'}
      />
    </>
  )
}

/** How a committee vote reads: against this page's replay once it has landed, else against the submitted result. */
function voteText(voteHash: string | null, replayHash: string | null, submitted: string | null): string {
  if (voteHash === null) return 'no vote'
  if (replayHash !== null) return voteHash === replayHash ? "voted ✓ same as this page's replay" : 'voted ✗ a different result'
  return voteHash === submitted ? 'voted: the submitted result is right' : 'voted: the submitted result is wrong'
}

function voteClass(voteHash: string | null, replayHash: string | null): string {
  if (voteHash === null) return 'waiting'
  if (replayHash === null) return 'voted'
  return voteHash === replayHash ? 'agrees' : 'disagrees'
}
