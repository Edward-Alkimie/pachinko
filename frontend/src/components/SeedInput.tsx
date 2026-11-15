import { useState, type FormEvent } from 'react'
import { checkRoundId, checkSeed, normalizeSeed } from '../lib/validation'

interface Props {
  /** Called with a valid, normalised seed and round id. */
  onReplay: (seedHex: string, roundId: bigint) => void
  disabled?: boolean
}

/**
 * Form to replay a specific seed + round id. Replaying the same pair must
 * always give the same balls, pockets and hash — that's the whole point.
 */
export function SeedInput({ onReplay, disabled = false }: Props) {
  const [seed, setSeed] = useState('')
  const [roundId, setRoundId] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    // Validate both fields; show the first problem found.
    const problem = checkSeed(seed) ?? checkRoundId(roundId)
    setError(problem)
    if (problem === null) onReplay(normalizeSeed(seed), BigInt(roundId.trim()))
  }

  return (
    <form className="seed-input" onSubmit={submit} aria-label="Replay a seed">
      <label>
        Seed
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="64 hex characters"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="round-id">
        Round
        <input value={roundId} onChange={(e) => setRoundId(e.target.value)} inputMode="numeric" />
      </label>
      <button type="submit" disabled={disabled}>
        Replay seed
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
