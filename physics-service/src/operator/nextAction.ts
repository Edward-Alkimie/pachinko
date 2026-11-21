/**
 * What the operator (and the arbiter) should do next for a round, decided from on-chain state only. Because the
 * decision reads the chain each time, the operator can restart at any point and pick up where it was.
 *
 *   BET_LOCKED → draw the seed · SEEDED → run physics and submit · SUBMITTED → finalize once the
 *   window has closed · CHALLENGED → leave it to the committee / arbiter · FINALIZED, REFUNDED → nothing left
 */
import { RoundStatus, type RoundView } from '@pachinko/chain'

/** Extra wait after the deadline, for clock differences between this machine and the chain. */
export const CLOCK_MARGIN_MS = 3_000

export type OperatorAction =
  | { readonly kind: 'drawSeed' }
  | { readonly kind: 'submit' }
  | { readonly kind: 'wait'; readonly untilMs: number }
  | { readonly kind: 'finalize' }
  /** Nothing more for the operator to do with this round. */
  | { readonly kind: 'drop'; readonly reason: string }

/**
 * @param deadlineMs challenge deadline of the submitted result (only needed when SUBMITTED)
 * @param configVersion physics version this operator runs
 */
export function nextAction(
  round: RoundView,
  deadlineMs: number | null,
  nowMs: number,
  configVersion: string,
): OperatorAction {
  switch (round.status) {
    case RoundStatus.BetLocked:
      return { kind: 'drawSeed' }
    case RoundStatus.Seeded:
      return round.configVersion === configVersion
        ? { kind: 'submit' }
        : { kind: 'drop', reason: `needs physics ${round.configVersion}, this operator runs ${configVersion}` }
    case RoundStatus.Submitted: {
      if (deadlineMs === null) throw new Error('a submitted round needs its deadline')
      const readyAt = deadlineMs + CLOCK_MARGIN_MS
      return nowMs >= readyAt ? { kind: 'finalize' } : { kind: 'wait', untilMs: readyAt }
    }
    case RoundStatus.Challenged:
      return { kind: 'drop', reason: 'challenged: the committee (or the admin fallback) settles it' }
    case RoundStatus.Finalized:
      return { kind: 'drop', reason: 'finalized' }
    case RoundStatus.Refunded:
      return { kind: 'drop', reason: 'refunded: no result before the submit deadline' }
  }
}

export type ArbiterAction =
  | { readonly kind: 'resolve' }
  | { readonly kind: 'wait'; readonly untilMs: number }
  /** Nothing for the arbiter to do with this round. */
  | { readonly kind: 'drop'; readonly reason: string }

/**
 * Arbiter (holds the AdminCap), the fallback for a committee that did not decide: once the vote
 * deadline has passed on a round still CHALLENGED, re-run its physics and pass the true outcomes
 * to `resolve_by_admin`; the contract compares hashes and picks the winner.
 *
 * @param voteDeadlineMs the dispute's vote deadline (only needed when CHALLENGED)
 */
export function arbiterAction(
  round: RoundView,
  voteDeadlineMs: number | null,
  nowMs: number,
  configVersion: string,
): ArbiterAction {
  if (round.status !== RoundStatus.Challenged) return { kind: 'drop', reason: 'not challenged (already settled)' }
  if (round.configVersion !== configVersion) {
    return { kind: 'drop', reason: `needs physics ${round.configVersion}, this arbiter runs ${configVersion}` }
  }
  if (voteDeadlineMs === null) throw new Error('a challenged round needs its vote deadline')
  const readyAt = voteDeadlineMs + CLOCK_MARGIN_MS
  return nowMs >= readyAt ? { kind: 'resolve' } : { kind: 'wait', untilMs: readyAt }
}
