/**
 * Reads the on-chain `Round` and its `Submission` (docs/SPEC.md §7). Both are decoded from BCS,
 * which is stable across transports (gRPC, GraphQL). Field order must match the Move structs.
 */
import { bcs } from '@mysten/sui/bcs'
import type { ClientWithCoreApi } from '@mysten/sui/client'
import type { Deployment } from './deployment'
import { fromOnchainOutcomes } from './outcomes'

/** `Round.status` values. */
export const RoundStatus = {
  BetLocked: 0,
  Seeded: 1,
  Submitted: 2,
  Challenged: 3,
  Finalized: 4,
} as const
export type RoundStatus = (typeof RoundStatus)[keyof typeof RoundStatus]

const RoundBcs = bcs.struct('Round', {
  id: bcs.Address,
  round_id: bcs.u64(),
  player: bcs.Address,
  config_version: bcs.string(),
  seed: bcs.vector(bcs.u8()),
  bet: bcs.u64(), // Balance<SUI> is a struct with one u64
  status: bcs.u8(),
})

const SubmissionBcs = bcs.struct('Submission', {
  house: bcs.Address,
  operator: bcs.Address,
  outcomes: bcs.vector(bcs.u16()),
  result_hash: bcs.vector(bcs.u8()),
  deadline_ms: bcs.u64(),
  operator_bond: bcs.u64(),
  challenger: bcs.option(bcs.Address),
  challenger_bond: bcs.u64(),
})

export interface RoundView {
  readonly objectId: string
  readonly roundId: bigint
  readonly player: string
  readonly configVersion: string
  /** `null` until the seed is drawn. */
  readonly seed: Uint8Array | null
  readonly betMist: bigint
  readonly status: RoundStatus
}

export interface SubmissionView {
  readonly operator: string
  /** Physics encoding (`-1` = never landed). */
  readonly outcomes: number[]
  readonly resultHash: Uint8Array
  readonly deadlineMs: number
  readonly challenger: string | null
}

export function parseRound(content: Uint8Array): RoundView {
  const r = RoundBcs.parse(content)
  return {
    objectId: r.id,
    roundId: BigInt(r.round_id),
    player: r.player,
    configVersion: r.config_version,
    seed: r.seed.length > 0 ? Uint8Array.from(r.seed) : null,
    betMist: BigInt(r.bet),
    status: r.status as RoundStatus,
  }
}

export function parseSubmission(value: Uint8Array): SubmissionView {
  const s = SubmissionBcs.parse(value)
  return {
    operator: s.operator,
    outcomes: fromOnchainOutcomes(s.outcomes),
    resultHash: Uint8Array.from(s.result_hash),
    deadlineMs: Number(s.deadline_ms),
    challenger: s.challenger ?? null,
  }
}

export async function fetchRound(client: ClientWithCoreApi, objectId: string): Promise<RoundView> {
  const { object } = await client.core.getObject({ objectId, include: { content: true } })
  return parseRound(object.content)
}

/** The round's submitted result. Only exists from SUBMITTED on. */
export async function fetchSubmission(
  client: ClientWithCoreApi,
  d: Deployment,
  roundObjectId: string,
): Promise<SubmissionView> {
  const { dynamicField } = await client.core.getDynamicField({
    parentId: roundObjectId,
    // `SubmissionKey()` has no fields; Move stores it with one `dummy_field: bool` (= false).
    name: { type: `${d.packageId}::verification::SubmissionKey`, bcs: new Uint8Array([0]) },
  })
  return parseSubmission(dynamicField.value.bcs)
}
