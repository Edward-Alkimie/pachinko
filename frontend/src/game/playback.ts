/**
 * Pure helpers for playing back a simulated round in real time.
 *
 * The physics runs ahead of time (runRound), recording ball positions every
 * `recordEvery` ticks. Playback only has to answer "what does the board look
 * like N milliseconds after Start?", which these functions compute.
 * They have no React or canvas code, so they're easy to test.
 */

const MS_PER_SECOND = 1000

/** Simulation tick reached after `elapsedMs` of real time (rounded down). */
export function tickAt(elapsedMs: number, tickHz: number): number {
  return Math.floor((elapsedMs / MS_PER_SECOND) * tickHz)
}

/**
 * Index of the frame to show at `tick`.
 * runRound records frame i right after tick (i + 1) · recordEvery, so before
 * the first recording there's nothing to show yet → -1.
 * After the last frame we keep showing the last one.
 */
export function frameIndexAt(tick: number, recordEvery: number, frameCount: number): number {
  const index = Math.floor(tick / recordEvery) - 1
  return Math.min(index, frameCount - 1)
}

export interface Tally {
  /** Number of balls in each pocket so far. */
  readonly perPocket: readonly number[]
  /** Total balls that have landed so far. */
  readonly landed: number
}

/**
 * Pocket counts as they'd look at `tick`: a ball only counts once its
 * landing tick has been reached, so the numbers fill in during playback.
 */
export function tallyAt(
  outcomes: readonly number[],
  landedAtTick: readonly number[],
  tick: number,
  pocketCount: number,
): Tally {
  const perPocket: number[] = new Array(pocketCount).fill(0)
  let landed = 0
  outcomes.forEach((pocket, ballId) => {
    const landedAt = landedAtTick[ballId]
    // pocket -1 = ball never landed; landedAt > tick = hasn't landed *yet*.
    if (pocket < 0 || landedAt < 0 || landedAt > tick) return
    perPocket[pocket]++
    landed++
  })
  return { perPocket, landed }
}
