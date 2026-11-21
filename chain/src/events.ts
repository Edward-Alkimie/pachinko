/**
 * BCS layouts of the contract's events (docs/SPEC.md §7). Field order must match the Move structs.
 */
import { bcs } from '@mysten/sui/bcs'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { DisputeView } from './objects'

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
  submit_deadline_ms: bcs.u64(),
})

export const Refunded = bcs.struct('Refunded', {
  round: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  amount: bcs.u64(),
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
  by_committee: bcs.bool(),
  result_hash: bcs.vector(bcs.u8()),
})

export const CommitteeSelected = bcs.struct('CommitteeSelected', {
  round: bcs.Address,
  round_id: bcs.u64(),
  committee: bcs.vector(bcs.Address),
  deadline_ms: bcs.u64(),
})

export const Voted = bcs.struct('Voted', {
  round: bcs.Address,
  round_id: bcs.u64(),
  voter: bcs.Address,
  result_hash: bcs.vector(bcs.u8()),
})

export const VerifierJoined = bcs.struct('VerifierJoined', { verifier: bcs.Address, stake: bcs.u64() })
export const VerifierLeft = bcs.struct('VerifierLeft', { verifier: bcs.Address, stake: bcs.u64() })
export const VerifierSlashed = bcs.struct('VerifierSlashed', { verifier: bcs.Address, amount: bcs.u64() })

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
  Refunded: 'round',
  ResultSubmitted: 'verification',
  Challenged: 'verification',
  CommitteeSelected: 'verification',
  Voted: 'verification',
  Resolved: 'verification',
  Finalized: 'verification',
  VerifierJoined: 'committee',
  VerifierLeft: 'committee',
  VerifierSlashed: 'committee',
} as const

export type EventName = keyof typeof MODULE_OF

/** Full Move type of an event, e.g. `0xpkg::round::RoundCreated`. */
export function eventType(packageId: string, name: EventName): string {
  return `${packageId}::${MODULE_OF[name]}::${name}`
}

/**
 * Events of type `name` that `matches` accepts, oldest first; only the first one if `firstOnly`.
 * Scans the package's events of that type oldest-first: descending scans run into the node's
 * pruned history. Fine for testnet volumes; an indexer would replace this later.
 */
async function scanEvents<T>(
  client: ClientWithCoreApi,
  packageId: string,
  name: EventName,
  layout: { parse(bytes: Uint8Array): T },
  matches: (event: T) => boolean,
  firstOnly: boolean,
): Promise<T[]> {
  const found: T[] = []
  let after: string | null = null
  for (;;) {
    const page = await client.core.listEvents({ filter: { eventType: eventType(packageId, name) }, after })
    for (const event of page.events.map((e) => layout.parse(e.bcs)).filter(matches)) {
      found.push(event)
      if (firstOnly) return found
    }
    if (!page.hasNextPage) return found
    after = page.endCursor
  }
}

/** The first event of type `name` about one round, or `null` if there is none yet. */
async function findRoundEvent<T extends { round: string }>(
  client: ClientWithCoreApi,
  packageId: string,
  name: EventName,
  layout: { parse(bytes: Uint8Array): T },
  roundObjectId: string,
): Promise<T | null> {
  const [event] = await scanEvents(client, packageId, name, layout, (e) => e.round === roundObjectId, true)
  return event ?? null
}

/** The round's `Finalized` event (its payout), or `null` while the round isn't final. */
export function findFinalized(client: ClientWithCoreApi, packageId: string, roundObjectId: string) {
  return findRoundEvent(client, packageId, 'Finalized', Finalized, roundObjectId)
}

/** The round's `Resolved` event (verdict, bond award), or `null` if it was never challenged and settled. */
export function findResolved(client: ClientWithCoreApi, packageId: string, roundObjectId: string) {
  return findRoundEvent(client, packageId, 'Resolved', Resolved, roundObjectId)
}

/**
 * A round's committee and its votes, read back from the `CommitteeSelected` and `Voted` events, or
 * `null` if no committee was drawn. Use this once the round is settled: the `Dispute` object
 * (`fetchDispute`) is removed in the same transaction as the deciding vote.
 */
export async function findCommitteeVotes(
  client: ClientWithCoreApi,
  packageId: string,
  roundObjectId: string,
): Promise<DisputeView | null> {
  const [selected, votes] = await Promise.all([
    findRoundEvent(client, packageId, 'CommitteeSelected', CommitteeSelected, roundObjectId),
    scanEvents(client, packageId, 'Voted', Voted, (e) => e.round === roundObjectId, false),
  ])
  if (!selected) return null
  return {
    deadlineMs: Number(selected.deadline_ms),
    committee: selected.committee,
    votes: votes.map((v) => ({ voter: v.voter, resultHash: Uint8Array.from(v.result_hash) })),
  }
}

/** The `RoundCreated` event of round number `roundId` (its object id, player, bet), or `null`. */
export async function findRoundByNumber(
  client: ClientWithCoreApi,
  packageId: string,
  roundId: bigint,
): Promise<typeof RoundCreated.$inferType | null> {
  const isRound = (e: typeof RoundCreated.$inferType) => BigInt(e.round_id) === roundId
  const [event] = await scanEvents(client, packageId, 'RoundCreated', RoundCreated, isRound, true)
  return event ?? null
}

/** Everything that happened to one round after the bet, from its events (`null` / empty = not yet). */
export interface RoundHistory {
  readonly submitted: typeof ResultSubmitted.$inferType | null
  readonly challenged: typeof Challenged.$inferType | null
  readonly committee: typeof CommitteeSelected.$inferType | null
  /** In the order they were cast. */
  readonly votes: (typeof Voted.$inferType)[]
  readonly resolved: typeof Resolved.$inferType | null
  readonly finalized: typeof Finalized.$inferType | null
  readonly refunded: typeof Refunded.$inferType | null
}

/** Reads a round's history from its events (one scan per event type, in parallel). */
export async function fetchRoundHistory(
  client: ClientWithCoreApi,
  packageId: string,
  roundObjectId: string,
): Promise<RoundHistory> {
  const ofRound = (e: { round: string }) => e.round === roundObjectId
  const [submitted, challenged, committee, votes, resolved, finalized, refunded] = await Promise.all([
    findRoundEvent(client, packageId, 'ResultSubmitted', ResultSubmitted, roundObjectId),
    findRoundEvent(client, packageId, 'Challenged', Challenged, roundObjectId),
    findRoundEvent(client, packageId, 'CommitteeSelected', CommitteeSelected, roundObjectId),
    scanEvents(client, packageId, 'Voted', Voted, ofRound, false),
    findRoundEvent(client, packageId, 'Resolved', Resolved, roundObjectId),
    findRoundEvent(client, packageId, 'Finalized', Finalized, roundObjectId),
    findRoundEvent(client, packageId, 'Refunded', Refunded, roundObjectId),
  ])
  return { submitted, challenged, committee, votes, resolved, finalized, refunded }
}
