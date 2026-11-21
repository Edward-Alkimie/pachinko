import type { ClientWithCoreApi } from '@mysten/sui/client'
import { describe, expect, it } from 'vitest'
import {
  Challenged,
  CommitteeSelected,
  Finalized,
  Resolved,
  RoundCreated,
  Voted,
  eventType,
  fetchRoundHistory,
  findRoundByNumber,
  type EventName,
} from '../src/events'

const PKG = `0x${'01'.repeat(32)}`
const id = (byte: string) => `0x${byte.repeat(32)}`
const ROUND = id('aa')
const OTHER = id('bb')
const HASH = new Array(32).fill(7)

/** A client whose listEvents serves the given events one per page, so paging is exercised. */
function fakeClient(events: Partial<Record<EventName, Uint8Array[]>>): ClientWithCoreApi {
  return {
    core: {
      listEvents: async ({ filter, after }: { filter: { eventType: string }; after: string | null }) => {
        const name = (Object.keys(events) as EventName[]).find((n) => eventType(PKG, n) === filter.eventType)
        const all = name ? events[name]! : []
        const index = after === null ? 0 : Number(after) + 1
        return {
          events: all.slice(index, index + 1).map((bcs) => ({ bcs })),
          hasNextPage: index + 1 < all.length,
          endCursor: String(index),
        }
      },
    },
  } as unknown as ClientWithCoreApi
}

const created = (round: string, roundId: number) =>
  RoundCreated.serialize({ round, round_id: roundId, player: id('02'), bet: 10, config_version: 'v' }).toBytes()
const voted = (round: string, voter: string) =>
  Voted.serialize({ round, round_id: 1, voter, result_hash: HASH }).toBytes()

describe('findRoundByNumber', () => {
  it('finds the round on a later page', async () => {
    const client = fakeClient({ RoundCreated: [created(OTHER, 1), created(ROUND, 2)] })
    expect((await findRoundByNumber(client, PKG, 2n))?.round).toBe(ROUND)
    expect(await findRoundByNumber(client, PKG, 3n)).toBeNull()
  })
})

describe('fetchRoundHistory', () => {
  it('collects only this round, and every one of its votes', async () => {
    const client = fakeClient({
      Challenged: [Challenged.serialize({ round: ROUND, round_id: 1, challenger: id('03'), bond: 10 }).toBytes()],
      CommitteeSelected: [
        CommitteeSelected.serialize({ round: ROUND, round_id: 1, committee: [id('51'), id('52')], deadline_ms: 9 }).toBytes(),
      ],
      Voted: [voted(ROUND, id('51')), voted(OTHER, id('53')), voted(ROUND, id('52'))],
      Resolved: [
        Resolved.serialize({
          round: ROUND,
          round_id: 1,
          operator_honest: false,
          winner: id('03'),
          award: 15,
          by_committee: true,
          result_hash: HASH,
        }).toBytes(),
      ],
      Finalized: [
        Finalized.serialize({ round: ROUND, round_id: 1, player: id('02'), payout: 10, result_hash: HASH }).toBytes(),
      ],
    })

    const history = await fetchRoundHistory(client, PKG, ROUND)
    expect(history.submitted).toBeNull()
    expect(history.challenged?.challenger).toBe(id('03'))
    expect(history.committee?.committee).toEqual([id('51'), id('52')])
    expect(history.votes.map((v) => v.voter)).toEqual([id('51'), id('52')])
    expect(history.resolved?.by_committee).toBe(true)
    expect(history.finalized?.payout).toBe('10')
    expect(history.refunded).toBeNull()
  })
})
