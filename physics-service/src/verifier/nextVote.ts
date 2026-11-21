/**
 * What one verifier should do next for a challenged round, decided from on-chain state only
 * (the round and its dispute), so the node can restart at any point. docs/CONTRACTS.md §11.
 *
 *   no committee yet → draw it · drawn and not voted → re-run and vote · otherwise nothing
 */
import { RoundStatus, type DisputeView, type RoundView } from '@pachinko/chain'

export type VerifierAction =
  | { readonly kind: 'select' }
  | { readonly kind: 'vote' }
  /** Nothing left for this verifier in this round. */
  | { readonly kind: 'done'; readonly reason: string }

/**
 * @param dispute the round's dispute (only needed while CHALLENGED)
 * @param me this verifier's address
 */
export function verifierAction(
  round: RoundView,
  dispute: DisputeView | null,
  me: string,
  nowMs: number,
  configVersion: string,
): VerifierAction {
  if (round.status !== RoundStatus.Challenged) return { kind: 'done', reason: 'settled' }
  if (round.configVersion !== configVersion) {
    return { kind: 'done', reason: `needs physics ${round.configVersion}, this verifier runs ${configVersion}` }
  }
  if (dispute === null) throw new Error('a challenged round needs its dispute')
  if (nowMs >= dispute.deadlineMs) return { kind: 'done', reason: 'vote closed' }
  if (dispute.committee.length === 0) return { kind: 'select' }
  if (!dispute.committee.includes(me)) return { kind: 'done', reason: 'not drawn' }
  if (dispute.votes.some((v) => v.voter === me)) return { kind: 'done', reason: 'voted' }
  return { kind: 'vote' }
}
