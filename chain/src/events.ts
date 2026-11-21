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
 * The first event of type `name` about one round, or `null` if there is none yet.
 * Scans the package's events of that type oldest-first: descending scans run into the node's
 * pruned history. Fine for testnet volumes; an indexer would replace this later.
 */
async function findRoundEvent<T extends { round: string }>(
  client: ClientWithCoreApi,
  packageId: string,
  name: EventName,
  layout: { parse(bytes: Uint8Array): T },
  roundObjectId: string,
): Promise<T | null> {
  let after: string | null = null
  for (;;) {
    const page = await client.core.listEvents({ filter: { eventType: eventType(packageId, name) }, after })
    const match = page.events.map((e) => layout.parse(e.bcs)).find((event) => event.round === roundObjectId)
    if (match) return match
    if (!page.hasNextPage) return null
    after = page.endCursor
  }
}

/** The round's `Finalized` event (its payout), or `null` while the round isn't final. */
export function findFinalized(client: ClientWithCoreApi, packageId: string, roundObjectId: string) {
  return findRoundEvent(client, packageId, 'Finalized', Finalized, roundObjectId)
}

/** The round's `Resolved` event (verdict, bond award), or `null` if it was never challenged and settled. */
export function findResolved(client: ClientWithCoreApi, packageId: string, roundObjectId: string) {
  return findRoundEvent(client, packageId, 'Resolved', Resolved, roundObjectId)
}
