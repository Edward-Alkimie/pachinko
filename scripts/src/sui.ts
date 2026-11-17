/**
 * Thin Sui helpers: gRPC client, one `execute` that prints every digest, and readers for
 * created objects and BCS events. Public testnet JSON-RPC is off, so this uses gRPC.
 */
import { execFileSync } from 'node:child_process'
import type { SuiClientTypes } from '@mysten/sui/client'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'

const EXPLORER_TX = 'https://suiscan.xyz/testnet/tx'
const INCLUDE = { effects: true, events: true, objectTypes: true } as const

export type Executed = SuiClientTypes.Transaction<typeof INCLUDE>

export interface Sui {
  readonly client: SuiGrpcClient
  readonly signer: Ed25519Keypair
  readonly address: string
}

export function connect(grpcUrl: string, privateKey: string): Sui {
  const signer = Ed25519Keypair.fromSecretKey(privateKey)
  return {
    client: new SuiGrpcClient({ network: 'testnet', baseUrl: grpcUrl }),
    signer,
    address: signer.toSuiAddress(),
  }
}

/** Signs and runs `tx`, prints `label  digest  explorer-link`, waits until it is indexed. */
export async function execute(sui: Sui, label: string, tx: Transaction): Promise<Executed> {
  const result = await sui.client.signAndExecuteTransaction({
    transaction: tx,
    signer: sui.signer,
    include: INCLUDE,
  })
  const executed = result.Transaction ?? result.FailedTransaction
  console.log(`${label.padEnd(16)} ${executed.digest}  ${EXPLORER_TX}/${executed.digest}`)
  if (!executed.status.success) {
    throw new Error(`${label} failed: ${JSON.stringify(executed.status.error)}`)
  }
  await sui.client.waitForTransaction({ result })
  return executed
}

/** Compiled modules + dependency ids of a Move package, ready for `tx.publish`. */
export function buildPackage(path: string): { modules: string[]; dependencies: string[] } {
  const out = execFileSync('sui', ['move', 'build', '--dump-bytecode-as-base64', '--path', path], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return JSON.parse(out)
}

/** Id of the package a publish transaction created. */
export function publishedPackageId(executed: Executed): string {
  const pkg = executed.effects.changedObjects.find((o) => o.outputState === 'PackageWrite')
  if (!pkg) throw new Error('publish created no package')
  return pkg.objectId
}

/** Id of the single object of Move type `type` that `executed` created. */
export function createdObjectId(executed: Executed, type: string): string {
  const ids = executed.effects.changedObjects
    .filter((o) => o.idOperation === 'Created' && executed.objectTypes[o.objectId] === type)
    .map((o) => o.objectId)
  if (ids.length !== 1) throw new Error(`expected one created ${type}, found ${ids.length}`)
  return ids[0]
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
