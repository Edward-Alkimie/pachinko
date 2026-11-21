/** The round's progress as a row of steps (`roundSteps`): done steps ticked, the current one lit. */
import type { OnchainStage } from '../hooks/useOnchainRound'
import { roundSteps } from '../onchain/roundSteps'

export function RoundSteps({ stage, challenged }: { stage: OnchainStage; challenged: boolean }) {
  const steps = roundSteps(stage, challenged)
  if (steps.length === 0) return null
  return (
    <ol className="round-steps" aria-label="Round progress">
      {steps.map(({ label, state }) => (
        <li key={label} className={state} aria-current={state === 'current' ? 'step' : undefined}>
          {state === 'done' ? `✓ ${label}` : label}
        </li>
      ))}
    </ol>
  )
}
