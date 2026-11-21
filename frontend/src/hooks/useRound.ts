/**
 * useRound: runs one round and plays it back in real time.
 *
 * Flow:  start(seed, roundId)   (resolves with the RoundResult once playback ends, or null if it
 *                                 failed or was replaced, so callers never reveal the result early)
 *          → status 'simulating' (UI shows "Simulating…")
 *          → runRound() computes the whole round up front (~1 s)
 *          → status 'playing': a requestAnimationFrame loop advances `tick`
 *            in step with the real clock (120 ticks = 1 second)
 *          → status 'done' once tick reaches the round's endTick
 *
 * The UI reads `tick` + `result` and derives which balls to draw and the tally
 * (see game/playback.ts), so this hook only owns timing and state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_CONFIG,
  initPhysics,
  parseSeed,
  runRound,
  type MachineConfig,
  type RoundResult,
} from '@pachinko/physics'
import { tickAt } from '../game/playback'

/** Record every 2nd tick: 120 Hz physics → 60 fps playback. */
export const RECORD_EVERY = 2

export type RoundStatus = 'idle' | 'simulating' | 'playing' | 'done' | 'error'

export interface RoundState {
  readonly status: RoundStatus
  readonly seedHex: string | null
  readonly roundId: bigint | null
  readonly result: RoundResult | null
  /** Current playback tick. */
  readonly tick: number
  readonly error: string | null
}

const INITIAL_STATE: RoundState = {
  status: 'idle',
  seedHex: null,
  roundId: null,
  result: null,
  tick: 0,
  error: null,
}

/** Lets the browser paint (e.g. the "Simulating…" label) before heavy work. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

export function useRound(config: MachineConfig = DEFAULT_CONFIG) {
  const [state, setState] = useState<RoundState>(INITIAL_STATE)
  const frameRequest = useRef<number | null>(null)
  // Incremented on every start(): a slow, older start() that finishes later
  // sees a different number and quietly gives up instead of overwriting.
  const runId = useRef(0)

  // Resolves the running start() when its playback is cut short (null) or ends (the result).
  const finishPlayback = useRef<((result: RoundResult | null) => void) | null>(null)

  const stopAnimation = useCallback(() => {
    if (frameRequest.current !== null) cancelAnimationFrame(frameRequest.current)
    frameRequest.current = null
    finishPlayback.current?.(null)
    finishPlayback.current = null
  }, [])

  // Stop the animation loop if the component using this hook goes away.
  useEffect(() => stopAnimation, [stopAnimation])

  const start = useCallback(
    async (seedHex: string, roundId: bigint): Promise<RoundResult | null> => {
      stopAnimation()
      const myRun = ++runId.current
      setState({ ...INITIAL_STATE, status: 'simulating', seedHex, roundId })

      let result: RoundResult
      try {
        await initPhysics()
        await nextPaint()
        if (myRun !== runId.current) return null
        result = runRound(parseSeed(seedHex), roundId, config, { recordEvery: RECORD_EVERY })
      } catch (err) {
        console.error('useRound: simulation failed', err)
        const message = err instanceof Error ? err.message : String(err)
        setState((s) => ({ ...s, status: 'error', error: `Simulation failed: ${message}` }))
        return null
      }
      if (myRun !== runId.current) return null

      // Playback: map wall-clock time since start to a simulation tick.
      const startedAt = performance.now()
      setState((s) => ({ ...s, status: 'playing', result, tick: 0 }))
      return new Promise<RoundResult | null>((resolve) => {
        finishPlayback.current = resolve
        const step = (now: number) => {
          const tick = Math.min(tickAt(now - startedAt, config.timing.tickHz), result.endTick)
          const finished = tick >= result.endTick
          setState((s) => ({ ...s, tick, status: finished ? 'done' : 'playing' }))
          if (!finished) {
            frameRequest.current = requestAnimationFrame(step)
            return
          }
          frameRequest.current = null
          finishPlayback.current = null
          resolve(result)
        }
        frameRequest.current = requestAnimationFrame(step)
      })
    },
    [config, stopAnimation],
  )

  return { state, start }
}
