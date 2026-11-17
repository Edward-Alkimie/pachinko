import type { MachineConfig } from '@pachinko/physics'
import type { Tally } from '../game/playback'
import type { RoundStatus } from '../hooks/useRound'

interface Props {
  config: MachineConfig
  status: RoundStatus
  tally: Tally
  seedHex: string | null
  roundId: bigint | null
  /** Only shown once the round has finished playing. */
  resultHash: string | null
  error: string | null
}

const STATUS_TEXT: Record<RoundStatus, string> = {
  idle: 'Play on-chain, or replay a seed, to see a round.',
  simulating: 'Simulating…',
  playing: 'Playing…',
  done: 'Round finished.',
  error: 'Something went wrong.',
}

/** Pocket tally (fills in as balls land), plus the seed and hash for replaying. */
export function ResultPanel({ config, status, tally, seedHex, roundId, resultHash, error }: Props) {
  const total = config.timing.ballsPerRound
  // Bars are scaled to the fullest pocket so differences are easy to see.
  const maxCount = Math.max(1, ...tally.perPocket)

  return (
    <section className="result-panel" aria-label="Round result">
      <p className="status" aria-live="polite">
        {error ?? STATUS_TEXT[status]}
      </p>
      <p className="landed">
        Landed <strong>{tally.landed}</strong> / {total}
      </p>

      <ol className="tally">
        {tally.perPocket.map((count, pocket) => (
          <li key={pocket}>
            <span className="pocket-id">{pocket}</span>
            <span className="bar" style={{ width: `${(count / maxCount) * 100}%` }} />
            <span className="count">{count}</span>
          </li>
        ))}
      </ol>

      <dl className="round-info">
        <dt>Round</dt>
        <dd>{roundId?.toString() ?? '—'}</dd>
        <dt>Seed</dt>
        <dd className="mono">{seedHex ?? '—'}</dd>
        <dt>Result hash</dt>
        <dd className="mono">{resultHash ?? '—'}</dd>
      </dl>
    </section>
  )
}
