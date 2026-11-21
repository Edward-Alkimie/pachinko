/**
 * Board result: the pocket tally of the round on the board (fills in as balls land), its seed and hash.
 * The board is simulated in this browser from the seed, so this is the result the operator must report.
 * Once the balls have landed and the operator's claim for this round is known, an Operator column shows
 * their counts next to the board's (differences in red), plus a "never landed" row: a forged result
 * reads as plain numbers, not just a different hash. The claim never shows before the balls land.
 */
import type { MachineConfig } from '@pachinko/physics'
import { countOutcomes, type Tally } from '../game/playback'
import type { RoundStatus } from '../hooks/useRound'
import { CopyValue } from './CopyValue'

interface Props {
  config: MachineConfig
  status: RoundStatus
  tally: Tally
  seedHex: string | null
  roundId: bigint | null
  /** Only shown once the round has finished playing. */
  resultHash: string | null
  /** The operator's claimed pocket per ball for this round (`-1` = never landed); null if none or not yet shown. */
  operatorOutcomes: readonly number[] | null
  error: string | null
}

const STATUS_TEXT: Record<RoundStatus, string> = {
  idle: 'Play on-chain, or verify a round, to see it on the board.',
  simulating: 'Simulating…',
  playing: 'Balls falling…',
  done: 'All balls are down.',
  error: 'Something went wrong.',
}

export function ResultPanel({ config, status, tally, seedHex, roundId, resultHash, operatorOutcomes, error }: Props) {
  const total = config.timing.ballsPerRound
  const done = status === 'done'
  // Bars are scaled to the fullest pocket so differences are easy to see.
  const maxCount = Math.max(1, ...tally.perPocket)
  const boardNever = done ? total - tally.landed : 0
  const operator = done && operatorOutcomes ? countOutcomes(operatorOutcomes, config.pockets.length) : null
  const differs = operator
    ? tally.perPocket.filter((count, pocket) => count !== operator.perPocket[pocket]).length +
      (boardNever !== operator.never ? 1 : 0)
    : 0

  return (
    <section className="result-panel" aria-label="Board result">
      <h2>Board result</h2>
      <p className="status" aria-live="polite">
        {error ?? STATUS_TEXT[status]}
      </p>
      <p className="landed">
        Landed <strong>{tally.landed}</strong> / {total}
      </p>
      {operator && (
        <p className={`claim-summary ${differs === 0 ? 'match' : 'mismatch'}`}>
          {differs === 0
            ? "✓ The operator's counts match the board."
            : `✗ The operator's counts differ from the board in ${differs} ${differs === 1 ? 'row' : 'rows'} (red).`}
        </p>
      )}

      <ol className={`tally ${operator ? 'with-operator' : ''}`}>
        {operator && (
          <li className="head" aria-hidden="true">
            <span>Pocket</span>
            <span />
            <span className="count">Board</span>
            <span className="count">Operator</span>
          </li>
        )}
        {tally.perPocket.map((count, pocket) => {
          const claimed = operator?.perPocket[pocket]
          return (
            <li key={pocket} className={claimed !== undefined && claimed !== count ? 'differs' : undefined}>
              <span className="pocket-id">{pocket}</span>
              <span className="bar" style={{ width: `${(count / maxCount) * 100}%` }} />
              <span className="count">{count}</span>
              {operator && <span className="count operator">{claimed}</span>}
            </li>
          )
        })}
        {done && (boardNever > 0 || operator) && (
          <li className={`never ${operator && operator.never !== boardNever ? 'differs' : ''}`}>
            <span className="pocket-id">–</span>
            <span className="label">never landed</span>
            <span className="count">{boardNever}</span>
            {operator && <span className="count operator">{operator.never}</span>}
          </li>
        )}
      </ol>

      <dl className="round-info">
        <dt>Round</dt>
        <dd>{roundId?.toString() ?? '—'}</dd>
        <dt>Seed</dt>
        {seedHex ? <CopyValue label="seed" value={seedHex} /> : <dd>—</dd>}
        <dt>Board hash</dt>
        {resultHash ? <CopyValue label="board hash" value={resultHash} /> : <dd>—</dd>}
      </dl>
    </section>
  )
}
