# Architecture: how data flows

How information moves between the major functions. **Keep this file updated**:
`physics/tests/docs.test.ts` fails if a public function of `@pachinko/physics`
isn't mentioned here.

Status: ✅ built · 🚧 next · ⏳ later

---

## 1. Big picture

```
                      docs/SPEC.md  (the shared contract)
                                │
              ┌─────────────────▼──────────────────┐
              │ physics/  (@pachinko/physics)      │  ← single source of truth
              │ config · geometry · seed · runRound│     same code everywhere
              └───────┬──────────────────┬─────────┘
          import      │                  │      import
        ┌─────────────▼──┐           ┌───▼──────────────┐
        │ frontend/      │           │ physics-service/ │◀── Kiana's verifier
        │ draw + play    │           │ re-run + check   │    (same package)
        └───────┬────────┘           └───▲──────────────┘
                │ HTTP                   │ HTTP POST /verify
                ▼                        │
        ┌────────────────────────────────┴─┐      ┌─────────────┐
        │ backend/ (Django)                │─────▶│ PostgreSQL  │
        │ rounds · results                 │      └─────────────┘
        └──────────────────────────────────┘
                ▲ seed (later from Sui: contracts/pachinko round.move)
```

Rule: **only `physics/` knows the rules of the machine.** Everyone else imports it.

---

## 2. Flow A: drawing the board ✅

> During play, `PachinkoCanvas` also calls `drawBalls` with the current frame (see Flow D).

```
DEFAULT_CONFIG ──┬─▶ buildPins(config)      ─▶ pin centres ─┐
(config.ts)      ├─▶ buildWalls(config)     ─▶ wall boxes  ─┤
                 ├─▶ buildDividers(config)  ─▶ divider boxes┼─▶ drawBoard(ctx, config, scale)
                 └─▶ pocketCentres(config)  ─▶ label points ┘        (frontend/src/game)
                                                                          │
App.tsx ─▶ <PachinkoCanvas config> ─▶ sets canvas size/DPR ─▶ calls ──────┘
```

`validateConfig(config)` checks the config is playable (returns `[]` when valid).
`ballsPerSecond(config)` is a helper for display and tests.

---

## 3. Flow B: one round (seed → outcomes) ✅

```
seed hex ─▶ parseSeed ─▶ 32 bytes ─┐                         ✅
roundId (bigint) ──────────────────┼─▶ deriveRoundLaunches(seed, roundId, config)
                                   │     └─ for each ball: deriveLaunch
                                   │          └─ deriveBytes = hmacSha256(seed, encodeMessage(round, ball, EVENT_LAUNCH))
                                   │          └─ bytesToUnit → x, vx
                                   ▼
                        Launch[] {ballId, tick, x, y, vx, vy}
                                   │
                                   ▼                          ✅
              initPhysics() once, then runRound(seed, roundId, config, { recordEvery })
                ├─ build Rapier world from buildWalls / buildDividers / buildPins
                ├─ every tick: add balls whose launch.tick == tick, world.step()
                ├─ ball below pocket line → outcome = pocket id
                └─ tick == maxTicks → remaining balls = -1
                                   │
                                   ▼
              { outcomes[], landedAtTick[], endTick, resultHash = hashRoundResult(...), frames[] }
```

Helpers: `randomSeedHex()` (local seeds until Sui), `seedToHex()`, `SEED_BYTES`.

---

## 3b. Flow D: playing a round in the browser ✅

```
Start button ─▶ randomSeedHex()            Replay form ─▶ checkSeed / checkRoundId
       └──────────────┬───────────────────────────────┘
                      ▼
          useRound.start(seedHex, roundId)
            status = simulating
            initPhysics() → runRound(seed, roundId, config, { recordEvery: 2 })
            status = playing; requestAnimationFrame loop:
              tick = tickAt(now − startedAt, 120)          (stops at endTick → done)
                      │
        App derives from { result, tick }:
          frameIndexAt(tick) → frames[i].balls ─▶ <PachinkoCanvas balls> → drawBoard + drawBalls
          tallyAt(outcomes, landedAtTick, tick) ─▶ <ResultPanel tally>
          status == done ─▶ show resultHash
```

## 4. Flow C: playing and verifying a round ⏳ (steps 5–7)

```
frontend                      backend (Django)              physics-service
────────                      ────────────────              ───────────────
POST /api/rounds/      ──────▶ create Round, seed
                       ◀────── { roundId, seed }
runRound(seed) locally
play frames on canvas
POST /api/results/     ──────▶ store client outcomes ─────▶ POST /verify {seed, roundId, outcomes}
  { roundId, outcomes }                                       runRound(seed) again
                                                              compare outcome per ball
                              store check + mismatches ◀──── { ok, mismatches[] }
                       ◀────── verified result
```

Server outcome wins on any mismatch.

---

## 5. Function index

### `physics/` (shared)

| Function | File | Input → Output | Used by | Status |
|---|---|---|---|---|
| `DEFAULT_CONFIG` | config.ts | — → `MachineConfig` (frozen) | everything | ✅ |
| `validateConfig` | config.ts | config → `string[]` problems | tests, (later) startup | ✅ |
| `buildPins` | config.ts | config → `Vec2[]` pin centres | drawBoard, runRound | ✅ |
| `ballsPerSecond` | config.ts | config → number | App, tests | ✅ |
| `buildWalls` | geometry.ts | config → `Box[]` (L, R, top, bottom) | drawBoard, runRound | ✅ |
| `buildDividers` | geometry.ts | config → `Box[]` | drawBoard, runRound | ✅ |
| `pocketCentres` | geometry.ts | config → `{id,x,y}[]` | drawBoard | ✅ |
| `parseSeed` / `seedToHex` | seed.ts | hex ⇄ 32 bytes | frontend, service, verifier | ✅ |
| `randomSeedHex` | seed.ts | — → hex seed | frontend (until Sui) | ✅ |
| `encodeMessage` | seed.ts | (round, ball, event) → 13 bytes | deriveBytes | ✅ |
| `hmacSha256` | seed.ts | (key, msg) → 32 bytes | deriveBytes | ✅ |
| `deriveBytes` | seed.ts | (seed, round, ball, event) → 32 bytes | deriveLaunch | ✅ |
| `bytesToUnit` | seed.ts | (bytes, offset) → [0, 1) | deriveLaunch | ✅ |
| `deriveLaunch` | seed.ts | (seed, round, ball, config) → `Launch` | deriveRoundLaunches | ✅ |
| `deriveRoundLaunches` | seed.ts | (seed, round, config) → `Launch[]` | runRound | ✅ |
| `EVENT_LAUNCH`, `SEED_BYTES` | seed.ts | constants | seed.ts, tests | ✅ |
| `initPhysics` | runRound.ts | — → Promise (loads Rapier WASM once) | frontend, service, verifier | ✅ |
| `runRound` | runRound.ts | (seed, roundId, config, {recordEvery}) → `RoundResult` | frontend, service, verifier | ✅ |
| `OUTCOME_NONE` | runRound.ts | constant `-1` (ball never landed) | everyone reading outcomes | ✅ |
| `encodeRoundResult` | hash.ts | {version, seed, roundId, outcomes} → bytes | hashRoundResult, (later) contract | ✅ |
| `hashRoundResult` | hash.ts | same → SHA-256 hex | runRound, backend, verifier | ✅ |

### `frontend/`

| Function / component | File | Does | Status |
|---|---|---|---|
| `App` | App.tsx | Start (random seed, round 1), replay form, board, results; derives balls + tally from {result, tick} | ✅ |
| `PachinkoCanvas` | game/PachinkoCanvas.tsx | canvas element, DPR, calls drawBoard + drawBalls each frame | ✅ |
| `drawBoard` / `boardPixelSize` | game/drawBoard.ts | paints the static board | ✅ |
| `drawBalls` | game/drawBoard.ts | paints the balls of one frame on top | ✅ |
| `tickAt` / `frameIndexAt` / `tallyAt` | game/playback.ts | real time → tick → frame to show; pocket counts so far | ✅ |
| `useRound` | hooks/useRound.ts | start(seed, roundId): runRound, then rAF playback; status idle → simulating → playing → done / error | ✅ |
| `ResultPanel` | components/ResultPanel.tsx | status, landed count, tally bars, round, seed, hash | ✅ |
| `SeedInput` | components/SeedInput.tsx | replay form; validates with `checkSeed` / `checkRoundId` (lib/validation.ts) | ✅ |
| `BOARD_COLORS` | game/theme.ts | colours | ✅ |
| `API_URL` | services/api.ts | backend base URL | ✅ (unused yet) |

### `physics-service/`

| Function | File | Does | Status |
|---|---|---|---|
| `createApp` | src/app.ts | HTTP: `GET /health` ✅, `POST /verify` ⏳ (501 now) | ✅ / ⏳ |
| `PORT` | src/config.ts | port from `PHYSICS_SERVICE_PORT` (validated) | ✅ |
| replay CLI | src/cli.ts | `npm run replay -- <seed>` | ⏳ |

### `backend/` and `contracts/` ⏳
Django apps `rounds` (create round + seed), `results` (store outcomes, call `/verify` via
`physics_client.py`). Move `round.move` (seed via `sui::random`).

---

## 6. Main data shapes

| Shape | Fields | Defined in |
|---|---|---|
| `MachineConfig` | version, board, wallThickness, gravity, ball, pin, pinGrid, pocketDepth, dividerThickness, pockets, launcher, timing | physics/src/config.ts |
| `Box` | x, y, halfWidth, halfHeight (centre + half sizes, like Rapier cuboids) | physics/src/geometry.ts |
| `Launch` | ballId, tick, x, y, vx, vy | physics/src/seed.ts |
| `RoundResult` | outcomes (pocket id per ball, -1 = never landed), landedAtTick, endTick, resultHash, frames | physics/src/runRound.ts |
| `Frame` | tick, balls: {id, x, y}[] (balls still on the board) | physics/src/runRound.ts |

Coordinates everywhere: centimetres, origin top-left, **y down**.
