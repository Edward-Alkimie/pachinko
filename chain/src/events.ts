/**
 * BCS layouts of the contract's events (docs/SPEC.md §7). Field order must match the Move structs.
 */
import { bcs } from '@mysten/sui/bcs'
import type { ClientWithCoreApi } from '@mysten/sui/client'

export const RoundCreated = bcs.struct('RoundCreated', {
  round: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  bet: bcs.u64(),
  config_version: bcs.string(),
})

export const SeedDrawn = bcs.struct('SeedDrawn', {
  round: bcs.Address,
  round_id: bcs.u64(),
  seed: bcs.vector(bcs.u8()),
})

export const ResultSubmitted = bcs.struct('ResultSubmitted', {
  round: bcs.Address,
  round_id: bcs.u64(),
  operator: bcs.Address,
  outcomes: bcs.vector(bcs.u16()),
  result_hash: bcs.vector(bcs.u8()),
  bond: bcs.u64(),
  deadline_ms: bcs.u64(),
})

export const Challenged = bcs.struct('Challenged', {
  round: bcs.Address,
  round_id: bcs.u64(),
  challenger: bcs.Address,
  bond: bcs.u64(),
})

export const Resolved = bcs.struct('Resolved', {
  round: bcs.Address,
  round_id: bcs.u64(),
  operator_honest: bcs.bool(),
  winner: bcs.Address,
  award: bcs.u64(),
  result_hash: bcs.vector(bcs.u8()),
})

export const Finalized = bcs.struct('Finalized', {
  round: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  payout: bcs.u64(),
  result_hash: bcs.vector(bcs.u8()),
})

const MODULE_OF = {
  RoundCreated: 'round',
  SeedDrawn: 'round',
  ResultSubmitted: 'verification',
  Challenged: 'verification',
  Resolved: 'verification',
  Finalized: 'verification',
} as const

export type EventName = keyof typeof MODULE_OF

/** Full Move type of an event, e.g. `0xpkg::round::RoundCreated`. */
export function eventType(packageId: string, name: EventName): string {
  return `${packageId}::${MODULE_OF[name]}::${name}`
}

/**
 * The `Finalized` event of one round (its payout), or `null` while the round isn't final.
 * Scans the package's `Finalized` events oldest-first: descending scans run into the node's
 * pruned history. Fine for testnet volumes; an indexer would replace this later.
 */
export async function findFinalized(
  client: ClientWithCoreApi,
  packageId: string,
  roundObjectId: string,
): Promise<typeof Finalized.$inferType | null> {
  let after: string | null = null
  for (;;) {
    const page = await client.core.listEvents({ filter: { eventType: eventType(packageId, 'Finalized') }, after })
    const match = page.events.map((e) => Finalized.parse(e.bcs)).find((f) => f.round === roundObjectId)
    if (match) return match
    if (!page.hasNextPage) return null
    after = page.endCursor
  }
}
