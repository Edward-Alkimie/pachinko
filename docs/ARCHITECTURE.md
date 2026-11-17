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

## 3c. Flow E: accounts (backend) ✅

```
frontend                                     Vite dev proxy           backend/apps/users
App ─ useAuth() ─▶ services/auth.ts ──▶ <base>api/* ──▶ :8000/api/* (Django + DRF, session cookie)
        │            fetchMe / login / register / logout   (sets Origin = backend)
        └▶ <AuthPanel state + actions>: form when signed out, "Signed in as …" when signed in

calls                                        backend view
GET  /api/auth/csrf      ──────────▶ CsrfView      sets csrftoken cookie
POST /api/auth/register  ──────────▶ RegisterView  RegisterSerializer → validate_password → create_user → login
POST /api/auth/login     ──────────▶ LoginView     authenticate → login   (bad user/password: same 400)
POST /api/auth/logout    ──────────▶ LogoutView    204
GET  /api/auth/me        ──────────▶ MeView        { id, username }  (403 when logged out)
```

- Writes send header `X-CSRFToken: <csrftoken cookie>`. Register/login are CSRF-checked
  and rate-limited per client IP (`AUTH_THROTTLE_RATE`, default `10/min`, scope `auth`;
  `DJANGO_NUM_PROXIES` = trusted proxies, 0 ignores `X-Forwarded-For`).
- Usernames are Unicode-normalized (NFKC) before the uniqueness check and on login.
- Passwords: Django hashing + the 4 standard password validators. Responses never include them.
- Database: SQLite (`backend/db.sqlite3`) unless `POSTGRES_HOST` is set, then PostgreSQL.
- `services/auth.ts` adds `X-CSRFToken` from the cookie on every POST (gets the cookie from
  `/auth/csrf` first if missing); backend errors become `ApiError {status, message, fieldErrors}`.
- Playing a round does not need an account yet.
- Contract for other code: `docs/SPEC.md` §5.
- Not yet: Sui wallet link / balance. Note for later: JSON-RPC is **off** on public testnet
  full nodes (checked 2026-11-17); use GraphQL `https://graphql.testnet.sui.io/graphql`
  (`address(address){ balance(coinType:"0x2::sui::SUI"){ totalBalance } }`) or gRPC.

## 4. Flow C: playing and verifying a round 🚧 (physics-service ✅, backend ⏳)

```
frontend                      backend (Django)              physics-service
────────                      ────────────────              ───────────────
POST /api/rounds/      ──────▶ create Round, seed
                       ◀────── { roundId, seed }
runRound(seed) locally
play frames on canvas
POST /api/results/     ──────▶ store client outcomes ─────▶ POST /verify {seed, roundId,
  { roundId, outcomes }                                          configVersion, outcomes}
                                                              parseVerifyRequest (400/409)
                                                              verifyRound: runRound again
                                                              compareOutcomes per ball
                              store check + mismatches ◀──── { ok, mismatches[],
                                                                serverOutcomes, resultHash }
                       ◀────── verified result
```

Server outcome wins on any mismatch. Contract: `docs/SPEC.md` §6.
Same check offline: `npm run replay -- <seed> [roundId]` prints the outcomes and hash.

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
| `App` | App.tsx | AuthPanel, Start (random seed, round 1), replay form, board, results; derives balls + tally from {result, tick} | ✅ |
| `PachinkoCanvas` | game/PachinkoCanvas.tsx | canvas element, DPR, calls drawBoard + drawBalls each frame | ✅ |
| `drawBoard` / `boardPixelSize` | game/drawBoard.ts | paints the static board | ✅ |
| `drawBalls` | game/drawBoard.ts | paints the balls of one frame on top | ✅ |
| `tickAt` / `frameIndexAt` / `tallyAt` | game/playback.ts | real time → tick → frame to show; pocket counts so far | ✅ |
| `useRound` | hooks/useRound.ts | start(seed, roundId): runRound, then rAF playback; status idle → simulating → playing → done / error | ✅ |
| `ResultPanel` | components/ResultPanel.tsx | status, landed count, tally bars, round, seed, hash | ✅ |
| `SeedInput` | components/SeedInput.tsx | replay form; validates with `checkSeed` / `checkRoundId` (lib/validation.ts) | ✅ |
| `BOARD_COLORS` | game/theme.ts | colours | ✅ |
| `API_URL` | services/api.ts | backend base URL: `<base>api` (Vite proxy) unless `VITE_API_URL` | ✅ |
| `fetchMe` / `login` / `register` / `logout` | services/auth.ts | accounts API calls; CSRF header; `ApiError` | ✅ |
| `readCookie` / `ApiError` | services/auth.ts | cookie lookup; failed request (status 0 = unreachable) | ✅ |
| `useAuth` | hooks/useAuth.ts | sign-in state: loading → anonymous / authenticated; login, register, logout, clearError | ✅ |
| `AuthPanel` | components/AuthPanel.tsx | login/register form (two modes) or "Signed in as …" + Log out | ✅ |

### `physics-service/`

| Function | File | Does | Status |
|---|---|---|---|
| `createApp` | src/app.ts | HTTP: `GET /health`, `POST /verify` (400 / 409 / 413 checks, 16 KiB body limit) | ✅ |
| `parseVerifyRequest` | src/verify.ts | untrusted body → `VerifyRequest` (seed, roundId, configVersion, 100 outcomes) or error | ✅ |
| `verifyRound` | src/verify.ts | re-run `runRound` on the server → `{ ok, mismatches, serverOutcomes, resultHash }` | ✅ |
| `compareOutcomes` | src/verify.ts | (server, client) → balls that differ `{ballId, client, server}` | ✅ |
| `parseSeedHex` / `parseRoundId` | src/parse.ts | shared input checks (seed hex, u64 round id) → `Parsed<T>` | ✅ |
| `parseReplayArgs` / `replayReport` | src/replay.ts | replay CLI: args → report (end tick, hash, pocket tally, outcomes) | ✅ |
| replay CLI | src/cli.ts | `npm run replay -- <seed> [roundId]` | ✅ |
| `PORT` | src/config.ts | port from `PHYSICS_SERVICE_PORT` (validated) | ✅ |

### `backend/` (Django)

| Function / view | File | Does | Owner | Status |
|---|---|---|---|---|
| `User` | apps/users/models.py | custom user (AbstractUser; extra fields go here later) | Kevin | ✅ |
| `RegisterSerializer` / `LoginSerializer` / `UserSerializer` | apps/users/serializers.py | request/response shapes; password write-only | Kevin | ✅ |
| `CsrfView` `RegisterView` `LoginView` `LogoutView` `MeView` | apps/users/views.py | `/api/auth/*` (Flow E) | Kevin | ✅ |
| rounds API | apps/rounds/ | create round + seed | Kevin | ⏳ |
| results API + `physics_client.py` | apps/results/ | store outcomes, call physics-service `/verify` | shared | ⏳ |
| verification API | `apps/verification/` (not created) | challenges, arbitration, payout status — URL prefix `/api/verification/` reserved | **Kiana** | ⏳ |

Ownership: Kevin keeps to `apps/users` and `apps/rounds`; Kiana owns anything under
`apps/verification` and `/api/verification/`. `apps/results` is shared — agree on changes first.

### `contracts/` ⏳
Move `round.move` (Kevin, seed via `sui::random`), `verification.move` (Kiana).

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
