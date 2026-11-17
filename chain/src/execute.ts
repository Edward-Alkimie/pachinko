/**
 * Server-side execution with a keypair (scripts, operator). The frontend signs with a wallet instead.
 */
import type { ClientWithCoreApi, SuiClientTypes } from '@mysten/sui/client'
import type { Signer } from '@mysten/sui/cryptography'
import type { Transaction } from '@mysten/sui/transactions'

const INCLUDE = { effects: true, events: true, objectTypes: true } as const

/** An executed transaction with its effects, events and changed-object types. */
export type Executed = SuiClientTypes.Transaction<typeof INCLUDE>

/** Signs and runs `tx`, throws if it aborted, and waits until it is indexed (so reads see it). */
export async function signAndExecute(
  client: ClientWithCoreApi,
  signer: Signer,
  tx: Transaction,
): Promise<Executed> {
  const result = await client.core.signAndExecuteTransaction({ transaction: tx, signer, include: INCLUDE })
  const executed = result.Transaction ?? result.FailedTransaction
  if (!executed.status.success) {
    throw new Error(`transaction ${executed.digest} failed: ${JSON.stringify(executed.status.error)}`)
  }
  await client.core.waitForTransaction({ result })
  return executed
}

/** Decodes the first event of Move type `type` with its BCS schema (e.g. a `bcs.struct`). */
export function readEvent<T>(
  executed: Executed,
  type: string,
  schema: { parse(bytes: Uint8Array): T },
): T {
  const event = executed.events.find((e) => e.eventType === type)
  if (!event) throw new Error(`no ${type} event in ${executed.digest}`)
  return schema.parse(event.bcs)
}
