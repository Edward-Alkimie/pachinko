/**
 * The result hashes of an on-chain round, with the board as the reference: the board's own hash (once
 * the balls land), what the operator submitted (shown as soon as it is on-chain: a hash gives nothing
 * away while the balls are still falling), and what the payout used (once final). The operator's and
 * the payout's rows get ✓/✗ against the board once the board's hash exists.
 */
import type { ReplayStatus } from '../hooks/useOnchainRound'
import { CopyValue } from './CopyValue'

interface Props {
  readonly submittedHash: string
  readonly replay: ReplayStatus
  /** The board's hash (this page's replay of the seed). */
  readonly replayHash: string | null
  /** The hash the payout used, once the round is final. */
  readonly paidHash?: string | null
}

const BOARD_PENDING: Record<Exclude<ReplayStatus, 'done'>, string> = {
  none: '—',
  playing: 'shown when the balls land…',
  interrupted: 'not computed (the board was given another round)',
}

export function ResultHashes({ submittedHash, replay, replayHash, paidHash = null }: Props) {
  const board = replay === 'done' ? replayHash : null
  const mark = (hash: string) => {
    if (board === null) return { className: '', mark: undefined }
    return hash === board ? { className: 'match', mark: '✓' } : { className: 'mismatch', mark: '✗' }
  }

  return (
    <dl className="result-hashes" aria-label="Result hashes">
      <dt>Board</dt>
      {board ? (
        <CopyValue label="board hash" value={board} />
      ) : (
        <dd className="pending">{BOARD_PENDING[replay === 'done' ? 'none' : replay]}</dd>
      )}
      <dt>Operator submitted</dt>
      <CopyValue label="operator's result hash" value={submittedHash} {...mark(submittedHash)} />
      {paidHash && (
        <>
          <dt>Paid on</dt>
          <CopyValue label="payout's result hash" value={paidHash} {...mark(paidHash)} />
        </>
      )}
    </dl>
  )
}
