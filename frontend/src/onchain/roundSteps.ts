/**
 * Where an on-chain round is, as a row of steps: Bet · Seed · Balls · Operator · Window (or Committee,
 * once challenged) · Paid (or Refunded). Shown by `RoundSteps`.
 */
import type { OnchainStage } from '../hooks/useOnchainRound'

export type StepState = 'done' | 'current' | 'todo'

export interface Step {
  readonly label: string
  readonly state: StepState
}

/** Index of the current step for each stage (past the end = all done). */
const CURRENT: Record<Exclude<OnchainStage, 'idle' | 'error'>, number> = {
  signing: 0,
  waitingSeed: 1,
  playing: 2,
  waitingResult: 3,
  verifying: 4,
  challenged: 4,
  final: 6,
  refunded: 4,
}

/** The steps for `stage`, or none before the bet and on an error. `challenged` = the round was ever challenged. */
export function roundSteps(stage: OnchainStage, challenged: boolean): Step[] {
  if (stage === 'idle' || stage === 'error') return []
  const labels =
    stage === 'refunded'
      ? ['Bet', 'Seed', 'Balls', 'Refunded']
      : ['Bet', 'Seed', 'Balls', 'Operator', challenged || stage === 'challenged' ? 'Committee' : 'Window', 'Paid']
  const current = CURRENT[stage]
  return labels.map((label, i) => ({ label, state: i < current ? 'done' : i === current ? 'current' : 'todo' }))
}
