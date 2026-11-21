/**
 * The Verify page's rules, kept pure: what a round's on-chain history plus this browser's own
 * replay say about it, and the page route (`#verify/<round>`, so a round can be shared as a link).
 */
import { RoundStatus, type RoundHistory } from '@pachinko/chain'
import { toHex } from '@mysten/sui/utils'

/**
 * verified       paid from the result your replay gives, never challenged
 * caught         a forged result was challenged and overturned; paid from your replay's result
 * upheld         a challenge failed: the operator was honest; paid from your replay's result
 * unchallenged   the operator's result is NOT what your replay gives, nobody challenged it in time, and it paid out
 * paidMismatch   the result the player was paid from is NOT what your replay gives, even after a challenge
 * refunded       no result arrived in time; the bet went back
 * inProgress     not settled yet
 */
export type Verdict = 'verified' | 'caught' | 'upheld' | 'unchallenged' | 'paidMismatch' | 'refunded' | 'inProgress'

/** The hash the player was paid from (the corrected one after a successful challenge), or null. */
export function paidHash(history: RoundHistory): string | null {
  return history.finalized ? toHex(Uint8Array.from(history.finalized.result_hash)) : null
}

/** What the page concludes. `replayHash` is this browser's replay of the round's seed. */
export function verdictOf(status: RoundStatus, history: RoundHistory, replayHash: string): Verdict {
  if (status === RoundStatus.Refunded) return 'refunded'
  const paid = paidHash(history)
  if (status !== RoundStatus.Finalized || paid === null) return 'inProgress'
  if (paid !== replayHash) return history.challenged ? 'paidMismatch' : 'unchallenged'
  if (!history.resolved) return 'verified'
  return history.resolved.operator_honest ? 'upheld' : 'caught'
}

export type Route = { readonly view: 'play' } | { readonly view: 'verify'; readonly round: bigint | null }

/** `#verify/12` → verify round 12 · `#verify` → the empty Verify view · anything else → play. */
export function parseRoute(hash: string): Route {
  const match = /^#verify(?:\/(\d+))?$/.exec(hash)
  if (!match) return { view: 'play' }
  return { view: 'verify', round: match[1] ? BigInt(match[1]) : null }
}

export function routeHash(route: Route): string {
  if (route.view === 'play') return ''
  return route.round === null ? '#verify' : `#verify/${route.round}`
}
