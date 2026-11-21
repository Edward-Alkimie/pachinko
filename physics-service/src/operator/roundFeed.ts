/**
 * New rounds from one event type (e.g. `RoundCreated` for the operator, `Challenged` for the
 * arbiter). Reads the package's events oldest-first from a cursor, so a restart sees every round
 * again and the caller re-checks each one against the chain.
 */
import type { ClientWithCoreApi } from '@mysten/sui/client'
import { eventType, type EventName } from '@pachinko/chain'

export interface RoundFeed {
  /** Object ids of rounds in events since the last call. */
  next(): Promise<string[]>
}

export function createRoundFeed(
  client: ClientWithCoreApi,
  packageId: string,
  name: EventName,
  layout: { parse(bytes: Uint8Array): { round: string } },
): RoundFeed {
  let cursor: string | null = null
  return {
    async next() {
      const rounds: string[] = []
      let hasNextPage = true
      while (hasNextPage) {
        const page = await client.core.listEvents({ filter: { eventType: eventType(packageId, name) }, after: cursor })
        for (const event of page.events) rounds.push(layout.parse(event.bcs).round)
        cursor = page.endCursor ?? cursor
        hasNextPage = page.hasNextPage
      }
      return rounds
    },
  }
}
