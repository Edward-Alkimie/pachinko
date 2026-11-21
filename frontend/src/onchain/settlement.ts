/**
 * What a final round did to the connected wallet, line by line, so the page can show the net
 * instead of a bare payout: bet out, challenge bond out (if this wallet challenged), payout in,
 * bonds in (if this wallet won the challenge).
 */
import type { OnchainState } from '../hooks/useOnchainRound'

export interface SettlementLine {
  readonly label: string
  /** Signed amount for this wallet: negative = paid, positive = received. */
  readonly mist: bigint
}

export interface Settlement {
  readonly lines: readonly SettlementLine[]
  readonly netMist: bigint
}

/** `null` until the round is final. */
export function settlement(
  state: Pick<OnchainState, 'phase' | 'payoutMist' | 'challengeDigest' | 'resolution'>,
  wallet: string | null,
  betMist: bigint,
  bondMist: bigint,
): Settlement | null {
  if (state.phase !== 'final' || state.payoutMist === null) return null
  const lines: SettlementLine[] = [{ label: 'Bet', mist: -betMist }]
  if (state.challengeDigest) lines.push({ label: 'Challenge bond', mist: -bondMist })
  lines.push({ label: 'Payout', mist: state.payoutMist })
  if (state.resolution && wallet !== null && state.resolution.winner === wallet) {
    lines.push({ label: 'Bonds won', mist: state.resolution.awardMist })
  }
  return { lines, netMist: lines.reduce((sum, line) => sum + line.mist, 0n) }
}
