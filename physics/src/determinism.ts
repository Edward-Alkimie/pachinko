/**
 * Determinism corpus (project plan §7, "Determinism test"): N fixed rounds whose result hashes are
 * folded into one SHA-256 digest. Every platform (Node on any OS, every browser, phones) must print
 * the same digest; checkpoints every 100 rounds show where a divergence starts.
 *
 *   seed_i  = SHA-256("PACHINKO-DETERMINISM-V1" ‖ u32 BE i),  round id = i + 1
 *   digest  = SHA-256(resultHash_0 ‖ resultHash_1 ‖ … ‖ resultHash_{N-1})   (32 raw bytes each)
 */
import { sha256 } from '@noble/hashes/sha2'
import type { MachineConfig } from './config'
import { runRound } from './runRound'

const CORPUS_TAG = new TextEncoder().encode('PACHINKO-DETERMINISM-V1')
/** A checkpoint digest is recorded after every this many rounds. */
export const CHECKPOINT_EVERY = 100

/** Seed of corpus round `index` (0-based). */
export function corpusSeed(index: number): Uint8Array {
  const message = new Uint8Array(CORPUS_TAG.length + 4)
  message.set(CORPUS_TAG)
  new DataView(message.buffer).setUint32(CORPUS_TAG.length, index)
  return sha256(message)
}

export interface DeterminismReport {
  readonly rounds: number
  readonly configVersion: string
  /** Lowercase hex SHA-256 over all result hashes, in order. */
  readonly digest: string
  /** Digest of the first `rounds` result hashes, every `CHECKPOINT_EVERY` rounds. */
  readonly checkpoints: readonly { readonly rounds: number; readonly digest: string }[]
}

/**
 * Runs the corpus. `afterRound` is awaited after each round (progress output; the browser uses it
 * to yield so the page stays responsive). Call `initPhysics()` first.
 */
export async function runDeterminismCorpus(
  rounds: number,
  config: MachineConfig,
  afterRound?: (done: number) => void | Promise<void>,
): Promise<DeterminismReport> {
  const hasher = sha256.create()
  const checkpoints: { rounds: number; digest: string }[] = []
  for (let i = 0; i < rounds; i++) {
    const { resultHash } = runRound(corpusSeed(i), BigInt(i + 1), config)
    hasher.update(hexToBytes(resultHash))
    if ((i + 1) % CHECKPOINT_EVERY === 0) checkpoints.push({ rounds: i + 1, digest: toHex(hasher.clone().digest()) })
    await afterRound?.(i + 1)
  }
  return { rounds, configVersion: config.version, digest: toHex(hasher.digest()), checkpoints }
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16))
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
