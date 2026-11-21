/**
 * The two result hashes of an on-chain round, side by side: what the operator submitted (shown as soon
 * as it is on-chain: a hash gives nothing away while the balls are still falling) and this page's own
 * replay (once the balls land). The submitted row gets ✓/✗ once both exist.
 */
import type { ReplayStatus } from '../hooks/useOnchainRound'
import { CopyValue } from './CopyValue'

interface Props {
  readonly submittedHash: string
  readonly replay: ReplayStatus
  readonly replayHash: string | null
}

const REPLAY_PENDING: Record<Exclude<ReplayStatus, 'done'>, string> = {
  none: '—',
  playing: 'shown when the balls land…',
  interrupted: 'not computed (the replay was interrupted)',
}

export function ResultHashes({ submittedHash, replay, replayHash }: Props) {
  const compared = replay === 'done' && replayHash !== null
  const match = compared ? submittedHash === replayHash : null

  return (
    <dl className="result-hashes" aria-label="Result hashes">
      <dt>Operator submitted</dt>
      <CopyValue
        label="operator's result hash"
        value={submittedHash}
        className={match === null ? '' : match ? 'match' : 'mismatch'}
        mark={match === null ? undefined : match ? '✓' : '✗'}
      />
      <dt>This page's replay</dt>
      {compared ? (
        <CopyValue label="this page's replay hash" value={replayHash} />
      ) : (
        <dd className="pending">{REPLAY_PENDING[replay === 'done' ? 'none' : replay]}</dd>
      )}
    </dl>
  )
}
