/**
 * Sui helpers for the scripts: gRPC client + keypair, an `execute` that prints every digest,
 * and the publish-only readers. Public testnet JSON-RPC is off, so this uses gRPC.
 */
import { execFileSync } from 'node:child_process'
import { TESTNET_EXPLORER_TX, signAndExecute, type Executed } from '@pachinko/chain'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction } from '@mysten/sui/transactions'

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

/** Signs and runs `tx`, then prints `label  digest  explorer-link`. Throws if it aborted. */
export async function execute(sui: Sui, label: string, tx: Transaction): Promise<Executed> {
  const executed = await signAndExecute(sui.client, sui.signer, tx).catch((error: Error) => {
    throw new Error(`${label}: ${error.message}`)
  })
  console.log(`${label.padEnd(16)} ${executed.digest}  ${TESTNET_EXPLORER_TX}/${executed.digest}`)
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
