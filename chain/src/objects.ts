/**
 * Reads the on-chain `Round`, its `Submission` and `Dispute`, and the `House`'s verifier pool
 * (docs/SPEC.md §7), decoded from BCS,
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
  Refunded: 5,
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
  submit_window_ms: bcs.u64(),
  submit_deadline_ms: bcs.u64(),
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

const DisputeBcs = bcs.struct('Dispute', {
  deadline_ms: bcs.u64(),
  excluded: bcs.vector(bcs.Address),
  committee: bcs.vector(bcs.Address),
  votes: bcs.vector(bcs.struct('Vote', { voter: bcs.Address, result_hash: bcs.vector(bcs.u8()) })),
})

const HouseBcs = bcs.struct('House', {
  id: bcs.Address,
  treasury: bcs.u64(),
  multipliers_bps: bcs.vector(bcs.u64()),
  balls_per_round: bcs.u64(),
  operator_bond: bcs.u64(),
  challenger_bond: bcs.u64(),
  challenge_window_ms: bcs.u64(),
  vote_window_ms: bcs.u64(),
  pool: bcs.struct('Pool', {
    stake: bcs.u64(),
    members: bcs.vector(bcs.Address),
    verifiers: bcs.struct('Table', { id: bcs.Address, size: bcs.u64() }),
  }),
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
  /** When the bet becomes refundable if no result was submitted (`0` until seeded). */
  readonly submitDeadlineMs: number
}

export interface SubmissionView {
  readonly operator: string
  /** Physics encoding (`-1` = never landed). */
  readonly outcomes: number[]
  readonly resultHash: Uint8Array
  readonly deadlineMs: number
  readonly challenger: string | null
}

export interface DisputeView {
  /** Votes are accepted before this; the admin fallback only from it on. */
  readonly deadlineMs: number
  /** Drawn verifiers (empty until `select_committee`). */
  readonly committee: string[]
  readonly votes: { readonly voter: string; readonly resultHash: Uint8Array }[]
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
    submitDeadlineMs: Number(r.submit_deadline_ms),
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

/** Addresses in the House's verifier pool. */
export function parsePoolMembers(houseContent: Uint8Array): string[] {
  return HouseBcs.parse(houseContent).pool.members
}

export function parseDispute(value: Uint8Array): DisputeView {
  const d = DisputeBcs.parse(value)
  return {
    deadlineMs: Number(d.deadline_ms),
    committee: d.committee,
    votes: d.votes.map((v) => ({ voter: v.voter, resultHash: Uint8Array.from(v.result_hash) })),
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

/** The open dispute of a challenged round (removed once it is settled). */
export async function fetchDispute(
  client: ClientWithCoreApi,
  d: Deployment,
  roundObjectId: string,
): Promise<DisputeView> {
  const { dynamicField } = await client.core.getDynamicField({
    parentId: roundObjectId,
    name: { type: `${d.packageId}::verification::DisputeKey`, bcs: new Uint8Array([0]) },
  })
  return parseDispute(dynamicField.value.bcs)
}

/** Addresses currently in the deployment's verifier pool. */
export async function fetchPoolMembers(client: ClientWithCoreApi, d: Deployment): Promise<string[]> {
  const { object } = await client.core.getObject({ objectId: d.houseId, include: { content: true } })
  return parsePoolMembers(object.content)
}
